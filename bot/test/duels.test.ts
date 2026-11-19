import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api.js';
import {
  DuelAnnouncer,
  activeMessage,
  challengeMessage,
  closedMessage,
  duelButtonId,
  finishedMessage,
  parseDuelButtonId,
  pointsMessage,
  statusMessage,
  type Duel,
} from '../src/duels.js';
import { parseEvent, type DuelFinished } from '../src/events.js';
import { InteractionHandler, commands } from '../src/interactions.js';
import type { MonsterCatalog } from '../src/monsterCatalog.js';

const ME = '111111111111111111';
const RIVAL = '222222222222222222';
const DUEL_ID = '01938f5e-0000-7000-8000-000000000001';

function duel(overrides: Partial<Duel> = {}): Duel {
  return {
    id: DUEL_ID,
    status: 'pending',
    minutes: 30,
    stake: 0,
    created_at: '2026-11-19T20:00:00Z',
    accept_by: '2026-11-19T20:10:00Z',
    starts_at: null,
    ends_at: null,
    scored_at: null,
    challenger: { name: 'Me', discord_user_id: ME, score: null, is_you: true },
    opponent: { name: 'Rival', discord_user_id: RIVAL, score: null, is_you: false },
    result: null,
    discord_channel_id: '33333333333',
    discord_message_id: '44444444444',
    ...overrides,
  };
}

const finished: DuelFinished = {
  duel_id: DUEL_ID,
  minutes: 60,
  stake: 0,
  challenger: { discord_user_id: ME, name: 'Me', score: 3 },
  opponent: { discord_user_id: RIVAL, name: 'Rival', score: 1 },
  result: 'challenger',
  discord_channel_id: '33333333333',
  discord_message_id: '44444444444',
};

describe('duel commands', () => {
  it('registers /duel with challenge, status and cancel, and /points', () => {
    const duelCmd = commands.find((c) => c.name === 'duel');
    expect(duelCmd?.options?.map((o) => o.name)).toEqual(['challenge', 'status', 'cancel']);
    const challenge = duelCmd?.options?.[0] as { options?: { name: string; required?: boolean }[] };
    expect(challenge.options?.map((o) => o.name)).toEqual(['opponent', 'minutes', 'stake']);
    expect(challenge.options?.find((o) => o.name === 'stake')?.required).toBeFalsy();
    expect(commands.find((c) => c.name === 'points')).toBeDefined();
  });

  it('round-trips the button ids and ignores others', () => {
    expect(parseDuelButtonId(duelButtonId('accept', DUEL_ID))).toEqual({ action: 'accept', duelId: DUEL_ID });
    expect(parseDuelButtonId(duelButtonId('decline', DUEL_ID))).toEqual({ action: 'decline', duelId: DUEL_ID });
    expect(parseDuelButtonId('duel|surrender|x')).toBeNull();
    expect(parseDuelButtonId('omw|abc')).toBeNull();
  });
});

describe('duel messages', () => {
  it('a challenge pings only the opponent and has Accept / Decline', () => {
    const message = challengeMessage(duel());
    expect(message.content).toBe(`<@${RIVAL}>`);
    expect(message.allowedMentions).toEqual({ parse: [], users: [RIVAL] });
    const buttons = (message.components![0] as { toJSON(): { components: { custom_id: string }[] } }).toJSON().components;
    expect(buttons.map((b) => b.custom_id)).toEqual([duelButtonId('accept', DUEL_ID), duelButtonId('decline', DUEL_ID)]);
  });

  it('an accepted duel loses its buttons and shows when it ends', () => {
    const message = activeMessage(duel({ status: 'active', starts_at: '2026-11-19T20:01:00Z', ends_at: '2026-11-19T20:31:00Z' }));
    expect(message.components).toEqual([]);
    const embed = (message.embeds![0] as { toJSON(): { fields: { name: string; value: string }[] } }).toJSON();
    expect(embed.fields.find((f) => f.name === 'Ends')!.value).toContain(`<t:${Date.parse('2026-11-19T20:31:00Z') / 1000}:R>`);
  });

  it('names the winner, or calls a draw', () => {
    const win = (finishedMessage(finished).embeds![0] as { toJSON(): { title: string; description: string } }).toJSON();
    expect(win.title).toBe('🏆 Me wins the duel!');
    expect(win.description).toContain('**3** : **1**');
    const draw = (finishedMessage({ ...finished, result: 'draw' }).embeds![0] as { toJSON(): { title: string } }).toJSON();
    expect(draw.title).toBe('🤝 The duel is a draw');
  });

  it('shows the stake, and who takes it', () => {
    const fields = (challengeMessage(duel({ stake: 20 })).embeds![0] as { toJSON(): { fields: { name: string; value: string }[] } }).toJSON().fields;
    expect(fields.find((f) => f.name === 'Stake')?.value).toContain('**20** point(s) at stake');
    const win = (finishedMessage({ ...finished, stake: 20 }).embeds![0] as { toJSON(): { description: string } }).toJSON();
    expect(win.description).toContain(`🪙 <@${ME}> takes **20** point(s) from <@${RIVAL}>.`);
    const draw = (finishedMessage({ ...finished, stake: 20, result: 'draw' }).embeds![0] as { toJSON(): { description: string } }).toJSON();
    expect(draw.description).toContain('Nobody loses');
  });

  it('says who called it off', () => {
    const text = (how: 'declined' | 'cancelled' | 'expired') =>
      (closedMessage(duel(), how).embeds![0] as { toJSON(): { description: string } }).toJSON().description;
    expect(text('declined')).toBe(`<@${RIVAL}> declined the duel.`);
    expect(text('cancelled')).toBe(`<@${ME}> took the challenge back.`);
  });

  it('shows the score so far and the record', () => {
    const list = {
      current: duel({
        status: 'active',
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 60_000).toISOString(),
        challenger: { name: 'Me', discord_user_id: ME, score: 2, is_you: true },
        opponent: { name: 'Rival', discord_user_id: RIVAL, score: 1, is_you: false },
      }),
      recent: [],
      record: { won: 4, lost: 1, drawn: 0 },
    };
    expect(statusMessage(list)).toContain(`<@${ME}> **2** : **1** <@${RIVAL}> so far.`);
    expect(statusMessage(list)).toContain('**4** won');
    expect(statusMessage({ ...list, current: null })).toContain('You are not in a duel');
  });

  it('lists the points and highlights the player', () => {
    const text = pointsMessage({
      period: '30d',
      points: 5,
      rank: 2,
      players: 7,
      top: [
        { rank: 1, player: 'Ace', points: 9, is_you: false },
        { rank: 2, player: 'Me', points: 5, is_you: true },
      ],
      duels: { won: 1, lost: 0, drawn: 0 },
    });
    expect(text).toContain('**5** point(s) (reports and duel stakes) in the last 30 days: #2 of 7.');
    expect(text).toContain('2. **Me**: 5');
  });
});

describe('duel events', () => {
  it('parses duel.finished and duel.expired', () => {
    const event = parseEvent(JSON.stringify({ event: 'duel.finished', occurred_at: '2026-11-19T21:00:00Z', data: finished }));
    expect(event).toEqual({ event: 'duel.finished', occurred_at: '2026-11-19T21:00:00Z', data: finished });

    const expired = parseEvent(
      JSON.stringify({
        event: 'duel.expired',
        data: { duel_id: DUEL_ID, challenger_discord_user_id: ME, opponent_discord_user_id: RIVAL, discord_channel_id: null, discord_message_id: null },
      }),
    );
    expect(expired.event).toBe('duel.expired');
  });

  it('rejects a duel.finished without a valid result', () => {
    expect(() => parseEvent(JSON.stringify({ event: 'duel.finished', data: { ...finished, result: 'nobody' } }))).toThrow(/result/);
  });

  it('edits the challenge and posts the result pinging both players', async () => {
    const original = { edit: vi.fn().mockResolvedValue(undefined) };
    const channel = {
      isTextBased: () => true,
      isSendable: () => true,
      messages: { fetch: vi.fn().mockResolvedValue(original) },
      send: vi.fn().mockResolvedValue(undefined),
    };
    const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };

    await new DuelAnnouncer(client as never).onFinished(finished);

    expect(original.edit).toHaveBeenCalledOnce();
    const sent = channel.send.mock.calls[0]![0];
    expect(sent.content).toBe(`<@${ME}> <@${RIVAL}>`);
    expect(sent.allowedMentions).toEqual({ parse: [], users: [ME, RIVAL] });
    expect(sent.reply).toEqual({ messageReference: '44444444444', failIfNotExists: false });
  });
});

describe('/duel challenge', () => {
  it('answers privately first, then posts the challenge publicly for the opponent', async () => {
    const calls: string[] = [];
    const created = duel();
    const api = {
      createDuel: vi.fn().mockResolvedValue(created),
      attachDuelMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient;
    const i = {
      commandName: 'duel',
      channelId: '33333333333',
      user: { id: ME },
      options: {
        getSubcommand: () => 'challenge',
        getUser: () => ({ id: RIVAL, bot: false, toString: () => `<@${RIVAL}>` }),
        getInteger: (name: string) => (name === 'stake' ? 15 : 30),
      },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isRepliable: () => true,
      deferReply: vi.fn(async () => void calls.push('defer')),
      editReply: vi.fn(async () => void calls.push('editReply')),
      followUp: vi.fn(async () => {
        calls.push('followUp');
        return { id: '44444444444', channelId: '33333333333' };
      }),
      reply: vi.fn(),
    };

    await new InteractionHandler(api, {} as MonsterCatalog, 'http://panel').handle(i as never);

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    // The first follow-up after an ephemeral defer would itself be ephemeral.
    expect(calls).toEqual(['defer', 'editReply', 'followUp']);
    const posted = (i.followUp.mock.calls[0] as unknown[])[0] as { flags?: unknown; content?: string };
    expect(posted.flags).toBeUndefined();
    expect(posted.content).toBe(`<@${RIVAL}>`);
    expect(api.createDuel).toHaveBeenCalledWith(ME, { opponent_discord_user_id: RIVAL, minutes: 30, stake: 15, discord_channel_id: '33333333333' });
    expect(api.attachDuelMessage).toHaveBeenCalledWith(created.id, '33333333333', '44444444444');
  });
});

describe('duel buttons', () => {
  function button(customId: string, userId: string) {
    return {
      customId,
      user: { id: userId },
      message: { edit: vi.fn().mockResolvedValue(undefined) },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isRepliable: () => true,
      deferReply: vi.fn(async function (this: { deferred: boolean }) {
        this.deferred = true;
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('[Accept] starts the duel and updates the challenge', async () => {
    const accepted = duel({ status: 'active', starts_at: '2026-11-19T20:01:00Z', ends_at: '2026-11-19T20:31:00Z' });
    const api = { acceptDuel: vi.fn().mockResolvedValue(accepted) } as unknown as ApiClient;
    const i = button(duelButtonId('accept', DUEL_ID), RIVAL);

    await new InteractionHandler(api, {} as MonsterCatalog, 'http://panel').handle(i as never);

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(api.acceptDuel).toHaveBeenCalledWith(RIVAL, DUEL_ID);
    expect(i.message.edit).toHaveBeenCalledWith(activeMessage(accepted));
    expect(i.editReply.mock.calls[0]![0]).toContain('Duel accepted');
  });

  it('an error goes to the clicker only, the challenge stays', async () => {
    const { ApiError } = await import('../src/api.js');
    const api = {
      acceptDuel: vi.fn().mockRejectedValue(new ApiError(403, { detail: 'Only the challenged player can accept this duel.' })),
    } as unknown as ApiClient;
    const i = button(duelButtonId('accept', DUEL_ID), ME);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await new InteractionHandler(api, {} as MonsterCatalog, 'http://panel').handle(i as never);

    expect(i.message.edit).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ content: '⚠️ Only the challenged player can accept this duel.', components: [] });
  });
});
