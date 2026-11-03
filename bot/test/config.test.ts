import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { API_BASE_URL: 'http://api', BOT_API_TOKEN: 't', AMQP_URL: 'amqp://x' };

function withEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries({ ...base, ...env })) vi.stubEnv(key, value);
}

describe('loadConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a bot token and strips a "Bot " prefix', () => {
    withEnv({ DISCORD_TOKEN: 'Bot MTIz.abc-_.xyz' });
    expect(loadConfig().discordToken).toBe('MTIz.abc-_.xyz');
  });

  it('allows an empty token (dry-run)', () => {
    withEnv({ DISCORD_TOKEN: '' });
    expect(loadConfig().discordToken).toBeNull();
  });

  it('rejects the application public key with a hint', () => {
    withEnv({ DISCORD_TOKEN: 'a'.repeat(64) });
    expect(() => loadConfig()).toThrow(/Public Key/);
  });
});

describe('loadConfig DISCORD_DM_ENABLED', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default and can be switched on', () => {
    withEnv({ DISCORD_TOKEN: '' });
    expect(loadConfig().directMessages).toBe(false);

    withEnv({ DISCORD_TOKEN: '', DISCORD_DM_ENABLED: 'true' });
    expect(loadConfig().directMessages).toBe(true);
  });
});

describe('loadConfig daily summary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 10:00 Warsaw time, can be moved or turned off', () => {
    withEnv({});
    expect(loadConfig()).toMatchObject({ summaryTime: [10, 0], summaryTimeZone: 'Europe/Warsaw' });
    withEnv({ DISCORD_SUMMARY_TIME: '9:30', DISCORD_SUMMARY_TIMEZONE: 'UTC' });
    expect(loadConfig()).toMatchObject({ summaryTime: [9, 30], summaryTimeZone: 'UTC' });
    withEnv({ DISCORD_SUMMARY_TIME: 'off' });
    expect(loadConfig().summaryTime).toBeNull();
  });

  it('rejects a bad time or zone', () => {
    withEnv({ DISCORD_SUMMARY_TIME: '25:00' });
    expect(() => loadConfig()).toThrow(/DISCORD_SUMMARY_TIME/);
    withEnv({ DISCORD_SUMMARY_TIME: '10:00', DISCORD_SUMMARY_TIMEZONE: 'Mars/Base' });
    expect(() => loadConfig()).toThrow(/DISCORD_SUMMARY_TIMEZONE/);
  });
});
