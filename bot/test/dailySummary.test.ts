import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailySummary, buildSummaryMessage, nextRunAt, parseTime, type WorldSummary } from '../src/dailySummary.js';

const monza: WorldSummary = {
  server_name: 'Monza', reports: 4, killed: 2, expired: 1, active: 1, responded: 3,
  monsters: [{ name: 'Dragon', reports: 3 }, { name: 'Hydra', reports: 1 }],
  reporters: [{ name: 'My_Knight', reports: 2 }, { name: 'Rival', reports: 2 }],
};

describe('nextRunAt', () => {
  it('is 10:00 Warsaw time today, or tomorrow once it has passed', () => {
    // Winter: Warsaw is UTC+1.
    expect(nextRunAt(new Date('2026-11-04T08:00:00Z'), [10, 0], 'Europe/Warsaw').toISOString()).toBe('2026-11-04T09:00:00.000Z');
    expect(nextRunAt(new Date('2026-11-04T09:00:00Z'), [10, 0], 'Europe/Warsaw').toISOString()).toBe('2026-11-05T09:00:00.000Z');
    // Summer: UTC+2, also across the change in March.
    expect(nextRunAt(new Date('2026-07-01T12:00:00Z'), [10, 0], 'Europe/Warsaw').toISOString()).toBe('2026-07-02T08:00:00.000Z');
    expect(nextRunAt(new Date('2026-03-28T12:00:00Z'), [10, 0], 'Europe/Warsaw').toISOString()).toBe('2026-03-29T08:00:00.000Z');
    // Late in the evening UTC it is already the next day in Warsaw.
    expect(nextRunAt(new Date('2026-11-04T23:30:00Z'), [10, 0], 'Europe/Warsaw').toISOString()).toBe('2026-11-05T09:00:00.000Z');
  });

  it('parses the configured time', () => {
    expect(parseTime('10:00')).toEqual([10, 0]);
    expect(parseTime('7:05')).toEqual([7, 5]);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('ten')).toBeNull();
  });
});

describe('buildSummaryMessage', () => {
  it('shows the numbers, the Wardens and the reporters, without pinging anyone', () => {
    const message = buildSummaryMessage(monza, new Date('2026-11-03T09:00:00Z'), new Date('2026-11-04T09:00:00Z'), 'https://warden.example/#history');
    const embed = (message.embeds![0] as { toJSON(): any }).toJSON();

    expect(embed.title).toBe('📊 Monza: the last 24 hours');
    expect(Object.fromEntries(embed.fields.map((f: any) => [f.name, f.value]))).toEqual({
      Reports: '4', Killed: '2', Expired: '1', 'Players who went': '3', 'Still up': '1',
      Wardens: 'Dragon — 3\nHydra — 1',
      'Top reporters': '1. My\\_Knight — 2\n2. Rival — 2',
    });
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect((message.components![0] as any).toJSON().components[0].url).toBe('https://warden.example/#history');
  });
});

describe('DailySummary', () => {
  afterEach(() => vi.useRealTimers());

  it('runs once a day at the set time with the end of the 24 hours', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-04T08:30:00Z') });
    const run = vi.fn().mockResolvedValue(undefined);
    const summary = new DailySummary([10, 0], 'Europe/Warsaw', run);
    summary.start();

    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledExactlyOnceWith(new Date('2026-11-04T09:00:00Z'));

    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(new Date('2026-11-05T09:00:00Z'));
    summary.stop();
  });

  it('keeps going after a failed run', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-04T08:59:00Z') });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValueOnce(new Error('api down')).mockResolvedValue(undefined);
    const summary = new DailySummary([10, 0], 'Europe/Warsaw', run);
    summary.start();

    await vi.advanceTimersByTimeAsync(25 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    summary.stop();
  });
});
