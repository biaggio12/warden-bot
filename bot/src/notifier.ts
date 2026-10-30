import { ChannelType, DiscordAPIError, RESTJSONErrorCodes, type Client, type Message, type TextChannel } from 'discord.js';
import { AlertPresence } from './alertPresence.js';
import type { ApiClient } from './api.js';
import type { WardenExpired, WardenKilled, WardenSpawned } from './events.js';
import {
  alertHeadline,
  allButtonsDisabled,
  buildDmNote,
  bestiaryUrlOf,
  buildSpawnMessage,
  disabledButtonRows,
  killNotice,
  killedAlert,
  killerOf,
  mentionChunks,
  monsterNameOfAlert,
  parsePostedAlert,
  presenceOf,
  withPresence,
} from './messages.js';
import type { MonsterCatalog } from './monsterCatalog.js';
import { SpawnRegistry, type CloseReason, type SentMessage } from './spawnRegistry.js';

const DM_CONCURRENCY = 5;
/** How far back the startup sweep looks in each alert channel. */
const SWEEP_MESSAGE_LIMIT = 100;

export interface NotifierOptions {
  /** Alerts go to text channels named `<prefix><world>`. */
  channelPrefix: string;
  /** Targeted DMs to players who still need the monster. */
  directMessages: boolean;
  /** On expiry delete the alert; otherwise keep it with its buttons disabled. */
  deleteExpired: boolean;
  /** How long the mentions stay in the alert before it is edited down to the headline. */
  pingCleanupMs: number;
  /** Web app address, for the alert's link to the bestiary page. */
  frontendUrl?: string;
  /** The presence lists the buttons keep (shared with the interaction handler). */
  presence?: AlertPresence;
}

/**
 * Turns backend events into Discord messages. With no Discord client (dry-run mode)
 * it only logs what it would send.
 */
export class Notifier {
  readonly registry: SpawnRegistry;
  private readonly bestiaryUrl: string | undefined;
  private readonly presence: AlertPresence;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly client: Client | null,
    private readonly api: ApiClient,
    private readonly catalog: MonsterCatalog,
    private readonly options: NotifierOptions,
  ) {
    this.bestiaryUrl = options.frontendUrl ? bestiaryUrlOf(options.frontendUrl) : undefined;
    this.presence = options.presence ?? new AlertPresence();
    this.registry = new SpawnRegistry((spawn, messages, reason) => this.expireMessages(spawn, messages, reason));
  }

  async onSpawned(spawn: WardenSpawned): Promise<void> {
    if (this.registry.get(spawn.spawn_id)) {
      return; // redelivered message, already announced
    }
    this.catalog.remember(spawn.monster);
    this.registry.register(spawn);

    const recipients = await this.recipientsOf(spawn);
    const mentionIds = recipients.map((r) => r.discord_user_id);

    if (!this.client) {
      console.info(
        `[dry-run] ${spawn.monster.name} @ ${spawn.server_name} (${[spawn.city, spawn.location_description].filter(Boolean).join(' — ')}) until ${spawn.expires_at};`,
        `ping -> ${mentionIds.join(', ') || 'nobody'};`,
        this.options.directMessages ? 'DMs enabled' : 'DMs disabled',
      );
      return;
    }

    const channels = await this.channelsFor(spawn);
    if (channels.length === 0) {
      console.warn(`[notify] No #${this.channelName(spawn.server_name)} channel for this report`);
    }
    for (const channel of channels) {
      await this.postAlert(channel, spawn, mentionIds);
    }

    await runLimited(this.options.directMessages ? recipients : [], DM_CONCURRENCY, async (recipient) => {
      const note = buildDmNote(recipient.characters);
      try {
        const user = await this.client!.users.fetch(recipient.discord_user_id);
        const message = await user.send(buildSpawnMessage(spawn, { note, bestiaryUrl: this.bestiaryUrl }));
        this.registry.addMessage(spawn.spawn_id, { channelId: message.channelId, messageId: message.id, note });
      } catch (error) {
        // Usually the player has DMs from server members disabled.
        console.warn(`[notify] DM to ${recipient.discord_user_id} failed:`, (error as Error).message);
      }
    });

    console.info(
      `[notify] ${spawn.monster.name} @ ${spawn.server_name}: ${channels.length} channel(s), ${mentionIds.length} player(s) pinged` +
        (this.options.directMessages ? ' and messaged' : ''),
    );
  }

  /**
   * Where a report is announced. A /report goes to the server it was used in only. A web
   * report goes to the servers the reporter is a member of; only when the reporter has no
   * linked Discord account (nothing to tell servers apart by) does it go to every server.
   */
  private async channelsFor(spawn: WardenSpawned): Promise<TextChannel[]> {
    const channels = this.alertChannels(spawn.server_name);
    if (spawn.discord_guild_id) {
      return channels.filter((channel) => channel.guild.id === spawn.discord_guild_id);
    }
    const reporter = spawn.reported_by_discord_user_id;
    if (!reporter) {
      return channels;
    }
    const memberships = await Promise.all(
      channels.map((channel) =>
        channel.guild.members
          .fetch(reporter)
          .then(() => true)
          .catch(() => false),
      ),
    );
    return channels.filter((_, i) => memberships[i]);
  }

  /**
   * Players with a linked Discord account and a character on that world missing the
   * monster (the reporter excluded). A failure only costs the pings, not the alert.
   */
  private async recipientsOf(spawn: WardenSpawned) {
    try {
      return (await this.api.getRecipients(spawn.spawn_id)).filter((r) => r.discord_user_id !== spawn.reported_by_discord_user_id);
    } catch (error) {
      console.warn(`[notify] Could not load players to ping for ${spawn.spawn_id}:`, (error as Error).message);
      return [];
    }
  }

  /**
   * Sends the alert with the mentions in its content (that is what pings people), then
   * after pingCleanupMs edits the content down to the headline. Mentions that do not
   * fit into one message go into extra messages, which are deleted at that point.
   */
  private async postAlert(channel: TextChannel, spawn: WardenSpawned, mentionIds: string[]): Promise<void> {
    const headline = alertHeadline(spawn);
    const [first, ...overflow] = mentionChunks(headline, mentionIds);
    const allowedMentions = { parse: [], users: mentionIds };

    let alert: Message;
    try {
      alert = await channel.send({ ...buildSpawnMessage(spawn, { onMyWay: true, bestiaryUrl: this.bestiaryUrl }), content: first, allowedMentions });
      this.registry.addMessage(spawn.spawn_id, { channelId: channel.id, messageId: alert.id });
    } catch (error) {
      console.error(`[notify] Could not post in #${channel.name} (${channel.guild.name}):`, error);
      return;
    }

    const extra: Message[] = [];
    for (const content of overflow) {
      try {
        extra.push(await channel.send({ content, allowedMentions }));
      } catch (error) {
        console.warn(`[notify] Could not send extra pings in #${channel.name}:`, (error as Error).message);
      }
    }

    if (mentionIds.length > 0) {
      this.schedule(this.options.pingCleanupMs, async () => {
        await ignoreUnknownMessage(alert.edit({ content: headline }), 'strip pings from');
        await Promise.all(extra.map((message) => ignoreUnknownMessage(message.delete(), 'delete ping message')));
      });
    }
  }

  async onExpired(event: WardenExpired): Promise<void> {
    const handled = await this.registry.expire(event.spawn_id);
    if (!handled) {
      console.info(`[notify] Spawn ${event.spawn_id} expired (not tracked or already handled)`);
    }
  }

  /**
   * A player reported the Warden dead. The alert is not removed yet: it is marked dead
   * with who reported it, its buttons are disabled, and the players on its OMW / On site
   * lists get a ping. It comes down when its original time runs out, as usual. Alerts
   * the registry does not know (posted before a restart) are looked up in the history.
   */
  async onKilled(event: WardenKilled): Promise<void> {
    if (!this.client?.user) {
      console.info(`[dry-run] Spawn ${event.spawn_id} @ ${event.server_name} reported killed`);
      return;
    }
    const tracked = this.registry.get(event.spawn_id) !== null;
    if (tracked && !this.registry.markKilled(event.spawn_id)) {
      return; // already over, or a redelivered event
    }
    const alerts = tracked ? await this.trackedAlerts(event.spawn_id) : await this.alertsInHistory(event);
    for (const alert of alerts) {
      await this.announceKill(alert, event);
    }
    console.info(`[notify] Spawn ${event.spawn_id} reported killed: ${alerts.length} alert(s) updated`);
  }

  /** Channel alerts only: DMs (they carry a note) have no presence lists to tell. */
  private async trackedAlerts(spawnId: string): Promise<Message[]> {
    const alerts: Message[] = [];
    for (const { channelId, messageId, note } of this.registry.messagesOf(spawnId)) {
      if (note) continue;
      const channel = await this.client!.channels.fetch(channelId).catch(() => null);
      const message = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
      if (message) alerts.push(message);
    }
    return alerts;
  }

  private async alertsInHistory(event: WardenKilled): Promise<Message[]> {
    const botId = this.client!.user!.id;
    const alerts: Message[] = [];
    for (const channel of this.alertChannels(event.server_name)) {
      const messages = await channel.messages.fetch({ limit: SWEEP_MESSAGE_LIMIT }).catch(() => null);
      for (const message of messages?.values() ?? []) {
        // Disabled buttons: already expired or already marked dead.
        if (message.author.id === botId && parsePostedAlert(message)?.spawnId === event.spawn_id && !allButtonsDisabled(message)) {
          alerts.push(message);
        }
      }
    }
    return alerts;
  }

  private async announceKill(alert: Message, event: WardenKilled): Promise<void> {
    const embed = alert.embeds[0];
    if (!embed) return;
    const killer = killerOf(event);
    // The lists as the buttons last left them, with no edit of theirs still on the way.
    const presence = (await this.presence.close(alert.id)) ?? presenceOf(embed.toJSON());

    try {
      const final = withPresence(embed.toJSON(), presence).toJSON();
      await alert.edit({ embeds: [killedAlert(final, killer, new Date())], components: disabledButtonRows(alert) });
    } catch (error) {
      console.warn(`[notify] Could not mark alert ${alert.id} as killed:`, (error as Error).message);
      return;
    }

    const waiting = [...presence.onMyWay, ...presence.onSite].filter((id) => id !== event.killed_by_discord_user_id);
    if (waiting.length === 0) return;

    const notices: Message[] = [];
    const allowedMentions = { parse: [], users: waiting, repliedUser: false };
    for (const content of killNotice(monsterNameOfAlert(alert), killer, waiting)) {
      try {
        notices.push(await alert.reply({ content, allowedMentions }));
      } catch (error) {
        console.warn(`[notify] Could not ping the players on the way:`, (error as Error).message);
      }
    }

    // The notices go together with the alert.
    const expiresAt = parsePostedAlert(alert)?.expiresAt;
    if (this.options.deleteExpired && expiresAt) {
      this.schedule(Math.max(0, expiresAt.getTime() - Date.now()), async () => {
        await Promise.all(notices.map((notice) => ignoreUnknownMessage(notice.delete(), 'delete kill notice')));
      });
    }
  }

  /**
   * Alerts posted before a restart are not in the in-memory registry. On startup,
   * scan the alert channels for our own alerts: retire the expired ones now and
   * schedule the rest for their expiry time.
   */
  async sweepChannels(): Promise<void> {
    if (!this.client?.user) {
      return;
    }
    const botId = this.client.user.id;
    let retired = 0;
    let scheduled = 0;

    for (const channel of this.alertChannels()) {
      let messages;
      try {
        messages = await channel.messages.fetch({ limit: SWEEP_MESSAGE_LIMIT });
      } catch (error) {
        console.warn(`[sweep] Cannot read #${channel.name} (missing Read Message History?):`, (error as Error).message);
        continue;
      }

      for (const message of messages.values()) {
        const alert = message.author.id === botId ? parsePostedAlert(message) : null;
        if (!alert || this.registry.get(alert.spawnId) || (!this.options.deleteExpired && allButtonsDisabled(message))) {
          continue;
        }
        const delay = alert.expiresAt.getTime() - Date.now();
        if (delay <= 0) {
          await this.retire(message);
          retired++;
        } else {
          this.schedule(delay, () => this.retire(message));
          scheduled++;
        }
      }
    }

    console.info(`[sweep] ${this.options.deleteExpired ? 'Deleted' : 'Disabled'} ${retired} expired alert(s), scheduled ${scheduled} active one(s)`);
  }

  dispose(): void {
    this.registry.clear();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private schedule(delayMs: number, task: () => Promise<void>): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void task();
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }

  private async expireMessages(spawn: WardenSpawned, messages: SentMessage[], reason: CloseReason): Promise<void> {
    if (!this.client) {
      console.info(`[dry-run] ${spawn.monster.name} @ ${spawn.server_name} ${reason}`);
      return;
    }
    await runLimited(messages, DM_CONCURRENCY, async ({ channelId, messageId, note }) => {
      try {
        await this.presence.close(messageId);
        const channel = await this.client!.channels.fetch(channelId);
        if (!channel?.isSendable()) {
          return;
        }
        if (this.options.deleteExpired) {
          await channel.messages.delete(messageId);
        } else if (reason === 'expired' || note) {
          // Channel alerts (no DM note) carry the presence buttons too.
          await channel.messages.edit(messageId, buildSpawnMessage(spawn, { expired: true, note, onMyWay: !note, bestiaryUrl: this.bestiaryUrl }));
        }
        // A killed channel alert already shows its final state; kept as it is.
      } catch (error) {
        if (!isUnknownMessage(error)) {
          console.warn(`[notify] Could not retire message ${messageId}:`, (error as Error).message);
        }
      }
    });
  }

  /** Expires an alert we only know from the channel history (see sweepChannels). */
  private async retire(message: Message): Promise<void> {
    try {
      await this.presence.close(message.id);
      if (this.options.deleteExpired) {
        await message.delete();
      } else {
        await message.edit({ components: disabledButtonRows(message) });
      }
    } catch (error) {
      if (!isUnknownMessage(error)) {
        console.warn(`[sweep] Could not retire message ${message.id}:`, (error as Error).message);
      }
    }
  }

  private channelName(serverName: string): string {
    return `${this.options.channelPrefix}${serverName.toLowerCase()}`;
  }

  /** Alert channels for one world, or every channel that can hold alerts. */
  private alertChannels(serverName?: string): TextChannel[] {
    const matches = (name: string) =>
      serverName === undefined ? name.startsWith(this.options.channelPrefix) : name === this.channelName(serverName);

    return this.client!.guilds.cache.flatMap((guild) =>
      guild.channels.cache.filter((c): c is TextChannel => c.type === ChannelType.GuildText && matches(c.name)),
    ).toJSON();
  }
}

/** The message is already gone (deleted by a moderator or an earlier run). */
function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage;
}

async function ignoreUnknownMessage(action: Promise<unknown>, what: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    if (!isUnknownMessage(error)) {
      console.warn(`[notify] Could not ${what} message:`, (error as Error).message);
    }
  }
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await task(item);
    }
  });
  await Promise.all(workers);
}
