import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TimestampStyles, escapeMarkdown, time, type BaseMessageOptions } from 'discord.js';

const HOUR_MS = 3_600_000;

export interface NamedCount {
  name: string;
  reports: number;
}

/** One world's numbers for the summary's window, as /internal/daily-summary returns them. */
export interface WorldSummary {
  server_name: string;
  reports: number;
  killed: number;
  expired: number;
  active: number;
  /** Players who clicked [On my way] or [No Need] on any of the alerts. */
  responded: number;
  monsters: NamedCount[];
  reporters: NamedCount[];
}

export interface DailySummaryData {
  since: string;
  until: string;
  worlds: WorldSummary[];
}

/** "10:00" -> [10, 0]; null for anything else (the summary is then off). */
export function parseTime(value: string): [number, number] | null {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The wall clock in `timeZone` at `at`, read as if it were UTC. */
function wallClock(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
}

/** The moment the clock in `timeZone` shows that date and time; month and day may overflow, as in Date.UTC. */
function atWallClock(year: number, month: number, day: number, [hour, minute]: [number, number], timeZone: string): Date {
  const wanted = Date.UTC(year, month, day, hour, minute);
  // Shift by the zone's offset, then once more in case the offset differs at that moment.
  let at = wanted - (wallClock(new Date(wanted), timeZone) - wanted);
  at = wanted - (wallClock(new Date(at), timeZone) - at);
  return new Date(at);
}

/** The next moment after `now` when the clock in `timeZone` shows hour:minute (summer time included). */
export function nextRunAt(now: Date, time: [number, number], timeZone: string): Date {
  const today = new Date(wallClock(now, timeZone));
  for (let day = 0; day <= 2; day++) {
    const at = atWallClock(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + day, time, timeZone);
    if (at > now) return at;
  }
  throw new Error('unreachable');
}

export interface SummaryWindow {
  since: Date;
  /** Goes into the title: "📊 Monza: <heading>". */
  heading: string;
}

/**
 * The summaries due at `until` (a daily run time): always the last 24 hours, on Mondays
 * also the last 7 days, and on the 1st also the whole previous month.
 */
export function summaryWindows(
  until: Date,
  time: [number, number],
  timeZone: string,
  { weekly = true, monthly = true }: { weekly?: boolean; monthly?: boolean } = {},
): SummaryWindow[] {
  const local = new Date(wallClock(until, timeZone));
  const [year, month, day] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  const windows: SummaryWindow[] = [{ since: new Date(until.getTime() - 24 * HOUR_MS), heading: 'the last 24 hours' }];
  if (weekly && local.getUTCDay() === 1) {
    windows.push({ since: atWallClock(year, month, day - 7, time, timeZone), heading: 'the last 7 days' });
  }
  if (monthly && day === 1) {
    const since = atWallClock(year, month - 1, 1, time, timeZone);
    const name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(Date.UTC(year, month - 1, 1));
    windows.push({ since, heading: name });
  }
  return windows;
}

const list = (rows: NamedCount[], numbered: boolean) =>
  rows.map((r, i) => `${numbered ? `${i + 1}. ` : ''}${escapeMarkdown(r.name)} — ${r.reports}`).join('\n');

export function buildSummaryMessage(world: WorldSummary, since: Date, until: Date, historyUrl?: string, heading = 'the last 24 hours'): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle(`📊 ${world.server_name}: ${heading}`)
    .setDescription(`${time(since, TimestampStyles.ShortDateTime)} – ${time(until, TimestampStyles.ShortDateTime)}`)
    .addFields({ name: 'Reports', value: String(world.reports) });
  if (world.monsters.length > 0) embed.addFields({ name: 'Wardens', value: list(world.monsters, false) });
  if (world.reporters.length > 0) embed.addFields({ name: 'Top reporters', value: list(world.reporters, true) });

  const components = historyUrl
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Full history').setURL(historyUrl))]
    : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/**
 * Runs once a day at the configured time (the run posts the daily summary, and the weekly
 * and monthly ones when they are due). A run that fails is not retried: the next one comes
 * the day after, as usual.
 */
export class DailySummary {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly at: [number, number],
    private readonly timeZone: string,
    private readonly run: (until: Date) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** `after`: the run that just happened, so a timer that fires a bit early cannot repeat it. */
  start(after?: Date): void {
    const from = new Date(Math.max(this.now().getTime(), after?.getTime() ?? 0));
    const next = nextRunAt(from, this.at, this.timeZone);
    // Long timers drift and Node caps them at ~24.8 days; re-check at most hourly.
    const delay = next.getTime() - this.now().getTime();
    this.timer = setTimeout(
      () => {
        if (delay > HOUR_MS) return this.start(after);
        void this.run(next)
          .catch((error) => console.error('[summary] Daily summary failed:', error))
          .finally(() => this.start(next));
      },
      Math.min(delay, HOUR_MS),
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
