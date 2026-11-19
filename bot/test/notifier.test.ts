import { ButtonStyle, ChannelType, Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api.js';
import type { WardenKilled } from '../src/events.js';
import type { MonsterCatalog } from '../src/monsterCatalog.js';
import { AlertChannels } from '../src/alertChannels.js';
import { AlertPresence } from '../src/alertPresence.js';
import { Notifier, type NotifierOptions } from '../src/notifier.js';
import { buildSpawnMessage, withPresence, type Presence } from '../src/messages.js';
import { postedAlert, spawnFixture } from './fixtures.js';

const BOT_ID = 'bot-user';

const GUILD_ROLE = '1528881722345652365';

function setup(
  options: Partial<NotifierOptions> = {},
  history: ReturnType<typeof postedAlert>[] = [],
  recipients = [{ discord_user_id: '42', characters: [{ id: 'c1', name: 'Sir Tester' }] }],
) {
  const byId = new Map<string, unknown>();
  const sent: { id: string; payload: any; edit: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }[] = [];
  const channelMessages = {
    delete: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    // fetch(id) -> one message from `byId`; fetch({ limit }) -> the channel history.
    fetch: vi.fn(async (arg: unknown) =>
      typeof arg === 'string' ? (byId.get(arg) ?? Promise.reject(new Error('Unknown Message'))) : new Collection(history.map((m) => [m.id, m])),
    ),
  };
  const channel = {
    id: 'chan-1',
    name: 'wardens-monza',
    type: ChannelType.GuildText,
    guild: {
      id: 'guild-1',
      name: 'Guild',
      members: { fetch: vi.fn(async (id: string) => ({ id })) },
      roles: { cache: new Collection([[GUILD_ROLE, { id: GUILD_ROLE }]]) },
    },
    send: vi.fn(async (payload: unknown) => {
      const message = { id: `msg-${sent.length + 1}`, payload, edit: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
      sent.push(message);
      return message;
    }),
    isSendable: () => true,
    isTextBased: () => true,
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

  return { notifier, channel, channelMessages, user, api, sent, byId, client };
}

function historyAlert(spawnId: string, expiresAt: string, author = BOT_ID) {
  const message = postedAlert(spawnFixture({ spawn_id: spawnId, expires_at: expiresAt }), {}, {
    author: { id: author },
    delete: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
  });
  return message as typeof message & { delete: ReturnType<typeof vi.fn>; edit: ReturnType<typeof vi.fn> };
}

/** A channel alert as discord.js returns it, with presence lists, that can be edited and replied to. */
function liveAlert(id: string, spawn = spawnFixture(), presence: Presence = { onMyWay: [], onSite: [] }) {
  const base = (buildSpawnMessage(spawn, { onMyWay: true }).embeds![0] as { toJSON(): any }).toJSON();
  const embed = withPresence(base, presence).toJSON();
  const notice = { delete: vi.fn().mockResolvedValue(undefined) };
  return {
    ...postedAlert(spawn, { onMyWay: true }),
    id,
    author: { id: BOT_ID },
    embeds: [{ title: embed.title, fields: embed.fields, toJSON: () => embed }],
    edit: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(notice),
    notice,
  };
}

const killed = (overrides: Partial<WardenKilled> = {}): WardenKilled => ({
  spawn_id: spawnFixture().spawn_id,
  monster_id: 142,
  server_name: 'Monza',
  killed_by_discord_user_id: '7',
  killed_by_name: null,
  ...overrides,
});

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
    expect(alert!.payload.allowedMentions).toEqual({ parse: [], users: ['42', '43'], roles: [] });
    expect(alert!.payload.embeds).toHaveLength(1);
    expect(alert!.payload.components[0].toJSON().components.map((c: { label: string }) => c.label)).toEqual(['Hit / Completed ✅', 'OMW', 'No Need', 'Dead']);
    expect(ctx.user.send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(alert!.edit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(alert!.edit).toHaveBeenCalledWith({ content: '**Dragon Warden**' });
  });

  it('splits a ping over the 2000 character limit and allows at most 100 mentions per message', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(123456789012345678n + BigInt(i)));
    const ctx = setup({}, [], ids.map((id) => ({ discord_user_id: id, characters: [{ id: `c${id}`, name: 'Sir Tester' }] })));
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture());

    expect(ctx.sent).toHaveLength(2);
    const [alert, extra] = ctx.sent;
    expect(alert!.payload.embeds).toHaveLength(1);
    expect(extra!.payload.embeds).toBeUndefined();
    for (const { payload } of ctx.sent) {
      expect(payload.content.length).toBeLessThanOrEqual(2000);
      expect(payload.allowedMentions.users.length).toBeLessThanOrEqual(100);
    }
    expect(ctx.sent.flatMap(({ payload }) => payload.allowedMentions.users)).toEqual(ids);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(alert!.edit).toHaveBeenCalledWith({ content: '**Dragon Warden**' });
    expect(extra!.delete).toHaveBeenCalledOnce();
  });

  it('pings the configured role on a server that has it, then edits it out too', async () => {
    const ctx = setup({ pingRoleIds: [GUILD_ROLE, '999999999999999999'] }, [], []);
    notifier = ctx.notifier;

    await notifier.onSpawned(spawnFixture());

    const [alert] = ctx.sent;
    // The other role does not exist on this server: left out, never shown as @deleted-role.
    expect(alert!.payload.content).toBe(`**Dragon Warden** <@&${GUILD_ROLE}>`);
    expect(alert!.payload.allowedMentions).toEqual({ parse: [], users: [], roles: [GUILD_ROLE] });
    await vi.advanceTimersByTimeAsync(1_000);
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

  it('marks the alert dead, pings the players on the way and removes it only at expiry', async () => {
    const ctx = setup();
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());
    const alert = liveAlert('msg-1', spawnFixture(), { onMyWay: ['42', '7'], onSite: ['43'] });
    ctx.byId.set('msg-1', alert);

    await notifier.onKilled(killed());

    const edit = alert.edit.mock.calls[0]![0];
    const embed = edit.embeds[0].toJSON();
    expect(embed.title).toBe('💀 Dragon Warden');
    expect(embed.description).toContain('reported by <@7>');
    expect(embed.fields.map((f: { name: string }) => f.name)).toContain('On my way (2)');
    // No "Disappears" countdown running into "x minutes ago": the kill time, and when it goes away.
    const fields = Object.fromEntries(embed.fields.map((f: { name: string; value: string }) => [f.name, f.value]));
    expect(fields).not.toHaveProperty('Disappears');
    expect(fields.Killed).toMatch(/^<t:\d+:t>$/);
    expect(fields.Removed).toMatch(/^<t:\d+:R>$/);
    // Only the bestiary link stays.
    expect(edit.components.flatMap((row: { toJSON(): any }) => row.toJSON().components).every((c: { style: number }) => c.style === ButtonStyle.Link)).toBe(true);

    const reply = alert.reply.mock.calls[0]![0];
    expect(reply.content).toBe('💀 **Dragon Warden** is dead, reported by <@7>. No need to come: <@42>');
    expect(reply.allowedMentions.users).toEqual(['42']);
    expect(ctx.channelMessages.delete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(7 * 60_000);
    expect(ctx.channelMessages.delete).toHaveBeenCalledWith('msg-1');
    expect(alert.notice.delete).toHaveBeenCalledOnce();
  });

  it('names a web-app player by their Discord username and pings nobody when no one is on the way', async () => {
    const ctx = setup();
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());
    const alert = liveAlert('msg-1');
    ctx.byId.set('msg-1', alert);

    await notifier.onKilled(killed({ killed_by_discord_user_id: null, killed_by_name: 'lukasz' }));

    expect(alert.edit.mock.calls[0]![0].embeds[0].toJSON().description).toContain('reported by **lukasz**');
    expect(alert.reply).not.toHaveBeenCalled();
  });

  it('announces a kill once when the event is redelivered', async () => {
    const ctx = setup();
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());
    const alert = liveAlert('msg-1', spawnFixture(), { onMyWay: ['42'], onSite: [] });
    ctx.byId.set('msg-1', alert);

    await notifier.onKilled(killed());
    await notifier.onKilled(killed());

    expect(alert.edit).toHaveBeenCalledOnce();
    expect(alert.reply).toHaveBeenCalledOnce();
  });

  it('keeps the dead alert as it is at expiry when deletion is turned off', async () => {
    const ctx = setup({ deleteExpired: false });
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());
    ctx.byId.set('msg-1', liveAlert('msg-1'));

    await notifier.onKilled(killed());
    await vi.advanceTimersByTimeAsync(7 * 60_000);

    // The alert stays for good: only the kill time, no countdown and no "Removed".
    const names = (ctx.byId.get('msg-1') as any).edit.mock.calls[0]![0].embeds[0].toJSON().fields.map((f: { name: string }) => f.name);
    expect(names).toContain('Killed');
    expect(names).not.toContain('Disappears');
    expect(names).not.toContain('Removed');
    expect(ctx.channelMessages.edit).not.toHaveBeenCalled();
    expect(ctx.channelMessages.delete).not.toHaveBeenCalled();
  });

  it('finds an alert from before a restart in the channel history when it is killed', async () => {
    const target = liveAlert('old', spawnFixture({ spawn_id: 'old-run-spawn' }), { onMyWay: ['42'], onSite: [] });
    const other = liveAlert('other', spawnFixture({ spawn_id: 'other-spawn' }));
    const ctx = setup({}, [target, other] as never);
    notifier = ctx.notifier;

    await notifier.onKilled(killed({ spawn_id: 'old-run-spawn' }));

    expect(target.edit).toHaveBeenCalledOnce();
    expect(target.reply).toHaveBeenCalledOnce();
    expect(target.delete).not.toHaveBeenCalled();
    expect(other.edit).not.toHaveBeenCalled();
  });

  it('a kill that arrives while the alert is still being posted waits for it and marks it dead', async () => {
    const ctx = setup();
    notifier = ctx.notifier;
    let recipientsLoaded!: (value: unknown[]) => void;
    ctx.api.getRecipients.mockReturnValueOnce(new Promise((resolve) => (recipientsLoaded = resolve)));

    // Both events are handled at once (the consumer prefetches several).
    const spawned = notifier.onSpawned(spawnFixture());
    const killedNow = notifier.onKilled(killed());
    recipientsLoaded([]);
    await Promise.all([spawned, killedNow]);

    const [alert] = ctx.sent;
    expect(alert).toBeDefined();
    expect(ctx.client.channels.fetch).toHaveBeenCalled();
    // The kill looked for the alert that was just posted, not an empty list.
    expect(ctx.channelMessages.fetch).toHaveBeenCalledWith(alert!.id);
  });

  it('after a restart pings every player on the way, also those the alert does not name', async () => {
    const players = Array.from({ length: 15 }, (_, i) => String(100000000000000000n + BigInt(i)));
    const target = liveAlert('old', spawnFixture({ spawn_id: 'old-run-spawn' }), { onMyWay: players, onSite: [] });
    const load = vi.fn().mockResolvedValue({ onMyWay: players, onSite: [] });
    const ctx = setup({ presence: new AlertPresence({ load, save: vi.fn() }) }, [target] as never);
    notifier = ctx.notifier;

    await notifier.onKilled(killed({ spawn_id: 'old-run-spawn' }));

    expect(load).toHaveBeenCalledWith('old-run-spawn', 'old');
    const pinged = target.reply.mock.calls.flatMap(([reply]) => reply.allowedMentions.users);
    expect(pinged).toEqual(players);
    // The final alert still names 10 of them and counts the rest.
    const final = target.edit.mock.calls[0]![0].embeds[0].toJSON().fields.find((f: { name: string }) => f.name.startsWith('On my way'));
    expect(final.name).toBe('On my way (15)');
    expect(final.value).toMatch(/ \+5$/);
  });
});

describe('Notifier when an admin deletes a report', () => {
  let notifier: Notifier | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  });
  afterEach(() => {
    notifier?.dispose();
    vi.useRealTimers();
  });

  it('deletes the alert at once, also when it would only be disabled on expiry', async () => {
    const ctx = setup({ deleteExpired: false });
    notifier = ctx.notifier;
    await notifier.onSpawned(spawnFixture());

    await notifier.onDeleted({ spawn_id: spawnFixture().spawn_id, server_name: 'Monza' });
    await notifier.onDeleted({ spawn_id: spawnFixture().spawn_id, server_name: 'Monza' }); // redelivered
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(ctx.channelMessages.delete).toHaveBeenCalledExactlyOnceWith('msg-1');
    // The expiry no longer touches it.
    expect(ctx.channelMessages.edit).not.toHaveBeenCalled();
  });

  it('finds an alert from before a restart in the channel history, also one already marked dead', async () => {
    const target = liveAlert('old', spawnFixture({ spawn_id: 'old-run-spawn' }));
    const other = liveAlert('other', spawnFixture({ spawn_id: 'other-spawn' }));
    const ctx = setup({}, [target, other] as never);
    notifier = ctx.notifier;

    await notifier.onDeleted({ spawn_id: 'old-run-spawn', server_name: 'Monza' });

    expect(target.delete).toHaveBeenCalledOnce();
    expect(other.delete).not.toHaveBeenCalled();
  });
});

describe('Notifier with the bot on several servers', () => {
  let notifier: Notifier | null = null;
  afterEach(() => notifier?.dispose());

  function twoServers(membersOfB: string[] = [], channels?: AlertChannels, names = { 'guild-a': 'wardens-monza', 'guild-b': 'wardens-monza' }) {
    const guilds = (['guild-a', 'guild-b'] as const).map((id) => {
      const channel = {
        id: `chan-${id}`,
        name: names[id],
        type: ChannelType.GuildText,
        guild: {
          id,
          name: id,
          members: { fetch: vi.fn(async (userId: string) => (id === 'guild-a' || membersOfB.includes(userId) ? { id: userId } : Promise.reject(new Error('Unknown Member')))) },
          roles: { cache: new Collection() },
        },
        send: vi.fn().mockResolvedValue({ id: `msg-${id}`, edit: vi.fn(), delete: vi.fn() }),
      };
      return { id, channel, guild: { channels: { cache: new Collection([[channel.id, channel]]) } } };
    });
    const client = { user: { id: BOT_ID }, guilds: { cache: new Collection(guilds.map((g) => [g.id, g.guild])) } };
    const api = { getRecipients: vi.fn().mockResolvedValue([]) };
    notifier = new Notifier(client as never, api as unknown as ApiClient, { remember: vi.fn() } as unknown as MonsterCatalog, {
      channelPrefix: 'wardens-',
      directMessages: false,
      deleteExpired: true,
      pingCleanupMs: 1_000,
      channels,
    });
    return { notifier, a: guilds[0]!.channel, b: guilds[1]!.channel };
  }

  it('posts to the channel chosen on the website, whatever its name', async () => {
    const channels = new AlertChannels(async () => [{ guild_id: 'guild-a', server_name: 'Monza', channel_id: 'chan-guild-a' }], 'wardens-');
    const { notifier, a, b } = twoServers([], channels, { 'guild-a': 'alerts', 'guild-b': 'wardens-monza' });

    await notifier.onSpawned(spawnFixture());

    expect(a.send).toHaveBeenCalledOnce();
    expect(b.send).toHaveBeenCalledOnce();
  });

  it('skips the named channel of a server where another channel was chosen', async () => {
    const channels = new AlertChannels(async () => [{ guild_id: 'guild-a', server_name: 'Monza', channel_id: 'deleted-channel' }], 'wardens-');
    const { notifier, a, b } = twoServers([], channels);

    await notifier.onSpawned(spawnFixture());

    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).toHaveBeenCalledOnce();
  });

  it('posts a /warden only on the server it was used in', async () => {
    const { notifier, a, b } = twoServers();

    await notifier.onSpawned(spawnFixture({ discord_guild_id: 'guild-b' }));

    expect(b.send).toHaveBeenCalledOnce();
    expect(a.send).not.toHaveBeenCalled();
  });

  it('posts a web report on the servers the reporter is a member of', async () => {
    const { notifier, a, b } = twoServers();

    await notifier.onSpawned(spawnFixture({ reported_by_discord_user_id: '42' }));

    expect(a.send).toHaveBeenCalledOnce();
    expect(b.send).not.toHaveBeenCalled();
  });

  it('posts a web report of a player without Discord on every server', async () => {
    const { notifier, a, b } = twoServers();

    await notifier.onSpawned(spawnFixture());

    expect(a.send).toHaveBeenCalledOnce();
    expect(b.send).toHaveBeenCalledOnce();
  });
});

describe('Notifier daily summary', () => {
  const summary = {
    since: '2026-11-03T09:00:00Z',
    until: '2026-11-04T09:00:00Z',
    worlds: [
      { server_name: 'Monza', reports: 2, killed: 1, expired: 1, active: 0, responded: 1, monsters: [{ name: 'Dragon', reports: 2 }], reporters: [{ name: 'Sir Tester', reports: 2 }] },
      { server_name: 'Antica', reports: 1, killed: 0, expired: 1, active: 0, responded: 0, monsters: [], reporters: [] },
    ],
  };

  it("posts each world's summary in that world's alert channel, with a link to the history", async () => {
    const { notifier, channel } = setup({ frontendUrl: 'https://warden.example/' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await notifier.postSummary(summary);

    // Only #wardens-monza exists: Antica has no channel here.
    expect(channel.send).toHaveBeenCalledOnce();
    const payload = channel.send.mock.calls[0]![0] as any;
    expect(payload.embeds[0].toJSON().title).toBe('📊 Monza: the last 24 hours');
    expect(payload.components[0].toJSON().components[0].url).toBe('https://warden.example/#history');
  });

  it('keeps going when a channel refuses the post', async () => {
    const { notifier, channel } = setup();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    channel.send.mockRejectedValueOnce(new Error('Missing Access'));

    await expect(notifier.postSummary(summary)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Could not post'), 'Missing Access');
  });
});
