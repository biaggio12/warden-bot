/**
 * Test tool: posts the summaries now, as the bot would at DISCORD_SUMMARY_TIME on the given day.
 *
 *   npm run summary                       today: the daily one (+ weekly on Mondays, monthly on the 1st)
 *   npm run summary -- 2026-11-02         as on Monday 2 November: daily + weekly
 *   npm run summary -- 2026-12-01 --only month
 *   npm run summary -- 2026-11-02 --dry-run   only prints the windows and numbers, posts nothing
 *
 * It logs in with the bot's own token next to the running bot (Discord allows that) and exits.
 * In the production image: node dist/sendSummary.js [same arguments].
 */
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { AlertChannels } from './alertChannels.js';
import { ApiClient } from './api.js';
import { loadConfig } from './config.js';
import { atWallClock, summaryWindows } from './dailySummary.js';
import { MonsterCatalog } from './monsterCatalog.js';
import { Notifier } from './notifier.js';

const KINDS = ['day', 'week', 'month'] as const;
type Kind = (typeof KINDS)[number];

function usage(message: string): never {
  console.error(`${message}\nUsage: npm run summary -- [YYYY-MM-DD] [--only day|week|month] [--dry-run]`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  let date: string | null = null;
  let only: Kind | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--only') {
      const kind = argv[++i] as Kind;
      if (!KINDS.includes(kind)) usage(`--only takes day, week or month, got "${argv[i] ?? ''}"`);
      only = kind;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) date = arg;
    else usage(`Unknown argument "${arg}"`);
  }
  return { date, only, dryRun };
}

const kindOf = (heading: string): Kind => (heading === 'the last 24 hours' ? 'day' : heading === 'the last 7 days' ? 'week' : 'month');

async function main(): Promise<void> {
  const { date, only, dryRun } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const time = config.summaryTime ?? [10, 0];
  const zone = config.summaryTimeZone;

  // The run time on that day (today by default) in the summary's time zone.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [year, month, day] = (date ?? today).split('-').map(Number) as [number, number, number];
  const until = atWallClock(year, month - 1, day, time, zone);
  if (Number.isNaN(until.getTime())) usage(`Not a date: ${date}`);

  // --only week/month is posted even when that day is not a Monday / the 1st.
  let windows = summaryWindows(until, time, zone, { weekly: config.summaryWeekly, monthly: config.summaryMonthly });
  if (only) {
    windows = summaryWindows(until, time, zone).filter((w) => kindOf(w.heading) === only);
    if (windows.length === 0) {
      // Not that weekday / not the 1st: fall back to the 7 days or the calendar month before.
      const since = only === 'week' ? atWallClock(year, month - 1, day - 7, time, zone) : atWallClock(year, month - 2, day, time, zone);
      windows = [{ since, heading: only === 'week' ? 'the last 7 days' : 'the last month' }];
    }
  }

  const api = new ApiClient(config.apiBaseUrl, config.botApiToken);
  const fmt = (d: Date) => d.toLocaleString('pl-PL', { timeZone: zone });
  console.info(`[summary-test] Run time ${fmt(until)} ${zone}; ${windows.length} summary(ies)${dryRun ? ' (dry run)' : ''}`);

  if (dryRun || !config.discordToken) {
    if (!config.discordToken) console.warn('[summary-test] DISCORD_TOKEN is empty: nothing will be posted');
    for (const w of windows) {
      const data = await api.getSummary(w.since, until);
      console.info(`\n📊 ${w.heading}: ${fmt(w.since)} – ${fmt(until)}`);
      if (data.worlds.length === 0) console.info('  no reports in this window (nothing would be posted)');
      for (const world of data.worlds) {
        console.info(`  ${world.server_name}: ${world.reports} report(s); Wardens: ${world.monsters.map((m) => `${m.name} ${m.reports}`).join(', ') || '-'}`);
      }
    }
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
  await client.login(config.discordToken);
  await ready;
  console.info(`[summary-test] Logged in as ${client.user?.tag} in ${client.guilds.cache.size} guild(s)`);

  try {
    const notifier = new Notifier(client, api, new MonsterCatalog(api), {
      channelPrefix: config.channelPrefix,
      channels: new AlertChannels(() => api.getAlertChannels(), config.channelPrefix),
      directMessages: false,
      deleteExpired: config.deleteExpired,
      pingCleanupMs: config.pingCleanupMs,
      frontendUrl: config.frontendUrl,
      pingRoleIds: [],
    });
    for (const w of windows) {
      const data = await api.getSummary(w.since, until);
      if (data.worlds.length === 0) console.info(`[summary-test] ${w.heading}: no reports, so nothing is posted`);
      await notifier.postSummary(data, w.heading);
    }
  } finally {
    await client.destroy();
  }
}

main().catch((error) => {
  console.error('[summary-test] Failed:', error);
  process.exit(1);
});
