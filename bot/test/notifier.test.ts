import { ChannelType, Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api.js';
import type { MonsterCatalog } from '../src/monsterCatalog.js';
import { Notifier, type NotifierOptions } from '../src/notifier.js';
import { postedAlert, spawnFixture } from './fixtures.js';

const BOT_ID = 'bot-user';

function setup(
  options: Partial<NotifierOptions> = {},
  history: ReturnType<typeof postedAlert>[] = [],
  recipients = [{ discord_user_id: '42', characters: [{ id: 'c1', name: 'Sir Tester' }] }],
) {
  const sent: { id: string; payload: any; edit: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }[] = [];
  const channelMessages = {
    delete: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(new Collection(history.map((m) => [m.id, m]))),
  };
  const channel = {
    id: 'chan-1',
    name: 'wardens-monza',
    type: ChannelType.GuildText,
    guild: { name: 'Guild' },
    send: vi.fn(async (payload: unknown) => {
      const message = { id: `msg-${sent.length + 1}`, payload, edit: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
      sent.push(message);
      return message;
    }),
    isSendable: () => true,
    messages: channelMessages,
  };
  const guild = { channels: { cache: new Collection([[channel.id, channel]]) } };
  const user = { send: vi.fn().mockResolvedValue({ id: 'dm-1', channelId: 'dm-chan' }) };
  const client = {
    user: { id: BOT_ID },
    guilds: { cache: new Collection([['guild-1', guild]]) },
    users: { fetch: vi.fn().mockResolvedValue(user) },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  };
  const api = {
    getRecipients: vi.fn().mockResolvedValue(recipients),
  };
  const catalog = { remember: vi.fn() } as unknown as MonsterCatalog;
  const notifier = new Notifier(client as never, api as unknown as ApiClient, catalog, {
    channelPrefix: 'wardens-',
    directMessages: false,
    deleteExpired: true,
    pingCleanupMs: 1_000,
    ...options,
  });

  return { notifier, channel, channelMessages, user, api, sent };
}

function historyAlert(spawnId: string, expiresAt: string, author = BOT_ID) {
  const message = postedAlert(spawnFixture({ spawn_id: spawnId, expires_at: expiresAt }), {}, {
    author: { id: author },
    delete: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
  });
  return message as typeof message & { delete: ReturnType<typeof vi.fn>; edit: ReturnType<typeof vi.fn> };
}

describe('Notifier', () => {
  let notifier: Notifier | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  });
  afterEach(() => {
    notifier?.dispose();
    vi.useRealTimers();
  });

  it('pings players missing the monster, then edits the alert down to its name', async () => {
    const ctx = setup({}, [], [
      { discord_user_id: '42', characters: [{ id: 'c1', name: 'Sir Tester' }] },
      { discord_user_id: '43', characters: [{ id: 'c2', name: 'Lady Tester' }] },
    ]);
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture());

    const [alert] = ctx.sent;
    expect(ctx.sent).toHaveLength(1);
    expect(alert!.payload.content).toBe('**Dragon Warden** <@42> <@43>');
    expect(alert!.payload.allowedMentions).toEqual({ parse: [], users: ['42', '43'] });
    expect(alert!.payload.embeds).toHaveLength(1);
    expect(alert!.payload.components[0].toJSON().components.map((c: { label: string }) => c.label)).toEqual(['Killed', 'OMW', 'On site']);
    expect(ctx.user.send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(alert!.edit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(alert!.edit).toHaveBeenCalledWith({ content: '**Dragon Warden**' });
  });

  it('does not ping the reporter and skips the edit when nobody is pinged', async () => {
    const ctx = setup();
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture({ reported_by_discord_user_id: '42' }));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(ctx.sent[0]!.payload.content).toBe('**Dragon Warden**');
    expect(ctx.sent[0]!.edit).not.toHaveBeenCalled();
  });

  it('still posts the alert when the player list cannot be loaded', async () => {
    const ctx = setup();
    ctx.api.getRecipients.mockRejectedValue(new Error('API down'));
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture());

    expect(ctx.sent[0]!.payload.content).toBe('**Dragon Warden**');
  });

  it('spreads many pings over extra messages and deletes those afterwards', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ discord_user_id: String(100000000000000000n + BigInt(i)), characters: [] }));
    const ctx = setup({}, [], many);
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture());

    expect(ctx.sent.length).toBeGreaterThan(1);
    for (const message of ctx.sent) {
      expect(message.payload.content.length).toBeLessThanOrEqual(2000);
    }
    const pinged = ctx.sent.flatMap((m) => m.payload.content.match(/<@\d+>/g) ?? []);
    expect(pinged).toHaveLength(120);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.sent[0]!.edit).toHaveBeenCalledWith({ content: '**Dragon Warden**' });
    for (const extra of ctx.sent.slice(1)) {
      expect(extra.delete).toHaveBeenCalledOnce();
    }
  });

  it('also sends targeted DMs when enabled', async () => {
    const ctx = setup({ directMessages: true });
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture());

    expect(ctx.api.getRecipients).toHaveBeenCalledWith(spawnFixture().spawn_id);
    expect(ctx.user.send).toHaveBeenCalledOnce();
  });

  it('deletes the alert when its time is up', async () => {
    const ctx = setup();
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());

    await vi.advanceTimersByTimeAsync(7 * 60_000);

    expect(ctx.channelMessages.delete).toHaveBeenCalledWith('msg-1');
    expect(ctx.channelMessages.edit).not.toHaveBeenCalled();
  });

  it('deletes the alert on WardenExpiredEvent before the local timer', async () => {
    const ctx = setup();
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());

    await notifier.onExpired({ spawn_id: spawnFixture().spawn_id, monster_id: 142, server_name: 'Monza', expires_at: '2026-10-29T12:07:00Z' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(ctx.channelMessages.delete).toHaveBeenCalledOnce();
  });

  it('only disables the buttons when deletion is turned off', async () => {
    const ctx = setup({ deleteExpired: false });
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());

    await vi.advanceTimersByTimeAsync(7 * 60_000);

    expect(ctx.channelMessages.delete).not.toHaveBeenCalled();
    expect(ctx.channelMessages.edit).toHaveBeenCalledOnce();
  });

  it('startup sweep deletes expired alerts left from before a restart and schedules active ones', async () => {
    const expired = historyAlert('old-spawn', '2026-10-29T11:50:00Z');
    const active = historyAlert('live-spawn', '2026-10-29T12:05:00Z');
    const foreign = historyAlert('someone-else', '2026-10-29T11:50:00Z', 'other-user');
    const ctx = setup({}, [expired, active, foreign]);
    notifier = ctx.notifier;

    await notifier.sweepChannels();

    expect(expired.delete).toHaveBeenCalledOnce();
    expect(active.delete).not.toHaveBeenCalled();
    expect(foreign.delete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(active.delete).toHaveBeenCalledOnce();
  });
});
