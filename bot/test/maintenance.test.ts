import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { InteractionHandler, commands } from '../src/interactions.js';
import { MaintenanceCommand, buildBackOnlineMessage, buildMaintenanceMessage, noticeFromEvent } from '../src/maintenance.js';
import type { ApiClient } from '../src/api.js';
import type { MonsterCatalog } from '../src/monsterCatalog.js';

const ADMIN = '111111111111111111';
const NOW = new Date('2026-11-19T20:00:00Z');

function interaction(userId: string, options: { sub?: 'start' | 'end'; minutes?: number | null; message?: string | null } = {}) {
  return {
    commandName: 'maintenance',
    user: { id: userId, tag: 'someone' },
    options: {
      getSubcommand: vi.fn(() => options.sub ?? 'start'),
      getInteger: vi.fn(() => options.minutes ?? null),
      getString: vi.fn(() => options.message ?? null),
    },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    deferReply: vi.fn(async function (this: { deferred: boolean }) {
      this.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function handler(announce = vi.fn().mockResolvedValue(3)) {
  const command = new MaintenanceCommand([ADMIN], announce, () => NOW);
  const api = {} as ApiClient;
  const catalog = {} as MonsterCatalog;
  return { announce, handler: new InteractionHandler(api, catalog, 'http://panel', 'wardens-', undefined, undefined, command) };
}

describe('/maintenance', () => {
  it('is registered with start and end, hidden from members without Administrator', () => {
    const command = commands.find((c) => c.name === 'maintenance');
    expect(command?.default_member_permissions).toBe('8');
    expect(command?.options?.map((o) => o.name)).toEqual(['start', 'end']);
  });

  it('posts the notice in every alert channel and tells the admin where', async () => {
    const { announce, handler: h } = handler();
    const i = interaction(ADMIN, { minutes: 15, message: 'New: element sensitivities' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await h.handle(i as never);

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const embed = announce.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.title).toBe('🛠️ Bot update in progress');
    const backAt = Math.floor(NOW.getTime() / 1000) + 15 * 60;
    expect(embed.fields.find((f: { name: string }) => f.name === 'Back').value).toBe(`around <t:${backAt}:t> (<t:${backAt}:R>)`);
    expect(embed.fields.find((f: { name: string }) => f.name === 'Note').value).toBe('New: element sensitivities');
    expect(i.editReply).toHaveBeenCalledWith('📢 Maintenance notice posted in 3 alert channel(s).');
  });

  it('end posts that the bot is back, with the note', async () => {
    const { announce, handler: h } = handler();
    const i = interaction(ADMIN, { sub: 'end', message: 'New: element sensitivities' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await h.handle(i as never);

    const embed = announce.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.title).toBe('✅ Bot is back');
    expect(embed.fields).toEqual([{ name: 'Note', value: 'New: element sensitivities' }]);
    expect(i.editReply).toHaveBeenCalledWith('📢 "Bot is back" notice posted in 3 alert channel(s).');
  });

  it('refuses anyone who is not a website admin, without posting', async () => {
    const { announce, handler: h } = handler();
    const i = interaction('222222222222222222');

    await h.handle(i as never);

    expect(announce).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith({ content: '⚠️ Only Warden Tracker admins can use this command.', flags: MessageFlags.Ephemeral });
  });

  it('says so when no channel took the notice', async () => {
    const { handler: h } = handler(vi.fn().mockResolvedValue(0));
    const i = interaction(ADMIN);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await h.handle(i as never);

    expect(i.editReply).toHaveBeenCalledWith('⚠️ No alert channel took the notice (see the bot logs).');
  });
});

describe('buildMaintenanceMessage', () => {
  it('leaves out the time and the note when not given, and pings nobody', () => {
    const message = buildMaintenanceMessage({ backAt: null, note: null }, NOW);
    const embed = (message.embeds![0] as { toJSON(): { fields: { name: string }[] } }).toJSON();

    expect(embed.fields.map((f) => f.name)).toEqual(['Reports']);
    expect(message.allowedMentions).toEqual({ parse: [] });
  });
});

describe('noticeFromEvent', () => {
  const event = { occurred_at: '2026-11-19T20:00:00Z', data: { back_at: '2026-11-19T20:15:00Z', note: 'Soon' } };

  it('takes the time and the note from the website', () => {
    expect(noticeFromEvent(event, new Date('2026-11-19T20:00:02Z'))).toEqual({ backAt: new Date('2026-11-19T20:15:00Z'), note: 'Soon' });
  });

  it('drops a notice that waited in the queue while the bot was down', () => {
    expect(noticeFromEvent(event, new Date('2026-11-19T20:06:00Z'))).toBeNull();
  });
});

describe('buildBackOnlineMessage', () => {
  it('has no fields without a note, and pings nobody', () => {
    const message = buildBackOnlineMessage(null, NOW);
    expect((message.embeds![0] as { toJSON(): { fields?: unknown[] } }).toJSON().fields ?? []).toEqual([]);
    expect(message.allowedMentions).toEqual({ parse: [] });
  });
});
