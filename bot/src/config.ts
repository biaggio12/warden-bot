import { parseTime } from './dailySummary.js';

export interface Config {
  /** Empty token = dry-run mode: events are consumed and logged, nothing is sent to Discord. */
  discordToken: string | null;
  applicationId: string | null;
  /** Register slash commands in this guild only (instant) instead of globally. */
  guildId: string | null;
  apiBaseUrl: string;
  botApiToken: string;
  amqpUrl: string;
  frontendUrl: string;
  healthPort: number;
  /** Public alerts go to text channels named `<prefix><world>`, e.g. #wardens-monza. */
  channelPrefix: string;
  /** Targeted DMs to players who still need the monster; off = channel alerts only. */
  directMessages: boolean;
  /** Delete alerts once they expire (otherwise keep them with disabled buttons). */
  deleteExpired: boolean;
  /** Mentions are edited out of the alert after this delay. */
  pingCleanupMs: number;
  /** Roles pinged with every alert, on the servers that have them (others skip them). */
  pingRoleIds: string[];
  /** When the daily summary of the last 24 hours is posted ("HH:MM"); null = off. */
  summaryTime: [number, number] | null;
  /** Time zone of summaryTime, e.g. Europe/Warsaw. */
  summaryTimeZone: string;
  /** At summaryTime on Mondays, also a summary of the last 7 days. */
  summaryWeekly: boolean;
  /** At summaryTime on the 1st, also a summary of the previous month. */
  summaryMonthly: boolean;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function flag(name: string, fallback: boolean): boolean {
  const value = optional(name);
  return value === null ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function required(name: string): string {
  const value = optional(name);
  if (value === null) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Bot tokens are three dot-separated base64url segments. */
const BOT_TOKEN_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function discordToken(): string | null {
  const token = optional('DISCORD_TOKEN')?.replace(/^Bot\s+/i, '') ?? null;
  if (token === null || BOT_TOKEN_PATTERN.test(token)) {
    return token;
  }
  const hint = /^[0-9a-f]{64}$/i.test(token)
    ? ' The value looks like the application Public Key (General Information page).'
    : '';
  throw new Error(
    `DISCORD_TOKEN is not a bot token.${hint} Copy the token from Developer Portal -> your app -> Bot -> Reset Token.`,
  );
}

/** DISCORD_SUMMARY_TIME: "HH:MM" (default 10:00, server save), or off. */
function summaryTime(): [number, number] | null {
  const value = optional('DISCORD_SUMMARY_TIME') ?? '10:00';
  if (['off', 'false', 'no', '0'].includes(value.toLowerCase())) return null;
  const parsed = parseTime(value);
  if (!parsed) throw new Error(`DISCORD_SUMMARY_TIME must look like 10:00 or be "off", got "${value}"`);
  return parsed;
}

function summaryTimeZone(): string {
  const zone = optional('DISCORD_SUMMARY_TIMEZONE') ?? 'Europe/Warsaw';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new Error(`DISCORD_SUMMARY_TIMEZONE is not a time zone: "${zone}"`);
  }
  return zone;
}

export function loadConfig(): Config {
  return {
    discordToken: discordToken(),
    applicationId: optional('DISCORD_APPLICATION_ID'),
    guildId: optional('DISCORD_GUILD_ID'),
    apiBaseUrl: required('API_BASE_URL').replace(/\/+$/, ''),
    botApiToken: required('BOT_API_TOKEN'),
    amqpUrl: required('AMQP_URL'),
    frontendUrl: optional('FRONTEND_URL') ?? 'http://localhost:5173',
    healthPort: Number(optional('HEALTH_PORT') ?? 3001),
    channelPrefix: process.env.CHANNEL_PREFIX?.trim() ?? 'wardens-',
    directMessages: flag('DISCORD_DM_ENABLED', false),
    deleteExpired: flag('DISCORD_DELETE_EXPIRED', true),
    pingCleanupMs: Number(optional('DISCORD_PING_CLEANUP_SECONDS') ?? 1) * 1000,
    pingRoleIds: (optional('DISCORD_PING_ROLE_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d{17,20}$/.test(id)),
    summaryTime: summaryTime(),
    summaryTimeZone: summaryTimeZone(),
    summaryWeekly: flag('DISCORD_SUMMARY_WEEKLY', true),
    summaryMonthly: flag('DISCORD_SUMMARY_MONTHLY', true),
  };
}
