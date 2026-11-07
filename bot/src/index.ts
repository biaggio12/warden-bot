import { sentryEnabled } from './instrument.js';
import * as Sentry from '@sentry/node';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { AlertChannels } from './alertChannels.js';
import { AlertPresence } from './alertPresence.js';
import { ApiClient } from './api.js';
import { loadConfig, type Config } from './config.js';
import { EventConsumer } from './consumer.js';
import { DailySummary, summaryWindows } from './dailySummary.js';
import { startHealthServer } from './health.js';
import { InteractionHandler, commands } from './interactions.js';
import { MonsterCatalog } from './monsterCatalog.js';
import { Notifier } from './notifier.js';
import { Watchdog } from './watchdog.js';

async function registerCommands(config: Config, applicationId: string): Promise<void> {
  const rest = new REST().setToken(config.discordToken!);
  const route = config.guildId
    ? Routes.applicationGuildCommands(applicationId, config.guildId)
    : Routes.applicationCommands(applicationId);
  await rest.put(route, { body: commands });
  console.info(`[discord] Registered ${commands.length} slash command(s) ${config.guildId ? `in guild ${config.guildId}` : 'globally'}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.info(`[sentry] ${sentryEnabled ? 'Errors and logs are sent to Sentry' : 'Disabled (SENTRY_DSN is empty)'}`);
  const api = new ApiClient(config.apiBaseUrl, config.botApiToken);
  const catalog = new MonsterCatalog(api);

  let client: Client | null = null;
  if (config.discordToken) {
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
  } else {
    console.warn('[discord] DISCORD_TOKEN is empty - running in dry-run mode (events are only logged)');
  }

  const presence = new AlertPresence({
    load: (spawnId, messageId) => api.getPresence(spawnId, messageId),
    save: (spawnId, messageId, lists) => api.savePresence(spawnId, messageId, lists),
  });
  const channels = new AlertChannels(() => api.getAlertChannels(), config.channelPrefix);
  const notifier = new Notifier(client, api, catalog, {
    channelPrefix: config.channelPrefix,
    channels,
    directMessages: config.directMessages,
    deleteExpired: config.deleteExpired,
    pingCleanupMs: config.pingCleanupMs,
    frontendUrl: config.frontendUrl,
    pingRoleIds: config.pingRoleIds,
    presence,
  });
  console.info(
    `[notify] DMs ${config.directMessages ? 'enabled' : 'disabled'}; expired alerts are ${config.deleteExpired ? 'deleted' : 'kept with disabled buttons'}`,
  );

  if (client) {
    const interactions = new InteractionHandler(api, catalog, config.frontendUrl, config.channelPrefix, presence, channels);

    client.once(Events.ClientReady, (ready) => {
      console.info(`[discord] Logged in as ${ready.user.tag} in ${ready.guilds.cache.size} guild(s)`);
      registerCommands(config, config.applicationId ?? ready.user.id).catch((error) =>
        console.error('[discord] Slash command registration failed:', error),
      );
      notifier.sweepChannels().catch((error) => console.error('[sweep] Failed:', error));
    });
    client.on(Events.InteractionCreate, (interaction) => void interactions.handle(interaction));
    client.on(Events.Error, (error) => {
      console.error('[discord] Client error:', error);
      Sentry.captureException(error);
    });
  }

  const consumer = new EventConsumer(config.amqpUrl, async (event) => {
    if (event.event === 'warden.spawned') {
      await notifier.onSpawned(event.data);
    } else if (event.event === 'warden.killed') {
      await notifier.onKilled(event.data);
    } else if (event.event === 'warden.deleted') {
      await notifier.onDeleted(event.data);
    } else {
      await notifier.onExpired(event.data);
    }
  });

  const health = startHealthServer(config.healthPort, () => ({
    amqp: consumer.connected,
    discord: client ? client.isReady() : null,
  }));

  if (client) {
    await client.login(config.discordToken!);
  }
  await consumer.start();

  const watchdog = new Watchdog(
    () => consumer.connected && (client ? client.isReady() : true),
    (downForMs) => {
      const message = `[watchdog] Cut off from ${consumer.connected ? 'Discord' : 'RabbitMQ'} for ${Math.round(downForMs / 60_000)} min, restarting`;
      console.error(message);
      Sentry.captureMessage(message, 'fatal');
      void Sentry.close(2000).finally(() => process.exit(1));
    },
  );
  watchdog.start();

  const summaryTime = config.summaryTime;
  const summary = summaryTime
    ? new DailySummary(summaryTime, config.summaryTimeZone, async (until) => {
        const windows = summaryWindows(until, summaryTime, config.summaryTimeZone, { weekly: config.summaryWeekly, monthly: config.summaryMonthly });
        let failure: unknown = null;
        // One failing (say the monthly) does not stop the others.
        for (const { since, heading } of windows) {
          try {
            await notifier.postSummary(await api.getSummary(since, until), heading);
          } catch (error) {
            failure = error;
          }
        }
        if (failure) throw failure;
      })
    : null;
  summary?.start();
  console.info(
    summaryTime
      ? `[summary] Daily at ${summaryTime.map((n) => String(n).padStart(2, '0')).join(':')} ${config.summaryTimeZone}` +
          `${config.summaryWeekly ? ', weekly on Mondays' : ''}${config.summaryMonthly ? ', monthly on the 1st' : ''}`
      : '[summary] Disabled (DISCORD_SUMMARY_TIME=off)',
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[bot] ${signal} received, shutting down`);
    watchdog.stop();
    summary?.stop();
    notifier.dispose();
    health.close();
    await consumer.stop();
    await client?.destroy();
    await Sentry.close(2000);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (error) => {
  console.error('[bot] Fatal error:', error);
  Sentry.captureException(error);
  await Sentry.close(2000);
  process.exit(1);
});
