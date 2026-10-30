import { MessageFlags, type APIEmbed } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type CharacterRef } from '../src/api.js';
import { InteractionHandler } from '../src/interactions.js';
import { buildSpawnMessage, goneButtonId, killButtonId, killSelectId, presenceButtonId, presenceOf, withPresence, type PresenceList } from '../src/messages.js';
import type { MonsterCatalog } from '../src/monsterCatalog.js';
import { spawnFixture } from './fixtures.js';

const target = { spawnId: 'spawn-1', monsterId: 142, serverName: 'Monza' };

function setup(characters: CharacterRef[] | Error, created = true) {
  const api = {
    getCharacters: characters instanceof Error ? vi.fn().mockRejectedValue(characters) : vi.fn().mockResolvedValue(characters),
    markKilled: vi.fn().mockResolvedValue(created),
  } as unknown as ApiClient & { getCharacters: ReturnType<typeof vi.fn>; markKilled: ReturnType<typeof vi.fn> };
  const catalog = { nameOf: vi.fn().mockResolvedValue('Dragon Warden') } as unknown as MonsterCatalog;
  const handler = new InteractionHandler(api, catalog, 'http://panel');

  const interaction = {
    customId: killButtonId(target),
    user: { id: '999000' },
    message: { id: 'alert-1', embeds: [], edit: vi.fn() },
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

  return { api, handler, interaction };
}

describe('[Killed] button', () => {
  it('scenario A: marks the only character on that world right away', async () => {
    const { api, handler, interaction } = setup([{ id: 'char-1', name: 'Sir Tester' }]);

    await handler.handle(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(api.getCharacters).toHaveBeenCalledWith('999000', 'Monza');
    expect(api.markKilled).toHaveBeenCalledWith('999000', 'char-1', 142);
    expect(interaction.editReply).toHaveBeenCalledWith('✅ **Dragon Warden** marked as killed for **Sir Tester**.');
  });

  it('scenario B: asks which character when there are several', async () => {
    const { api, handler, interaction } = setup([
      { id: 'char-1', name: 'Sir Tester' },
      { id: 'char-2', name: 'Lady Tester' },
    ]);

    await handler.handle(interaction as never);

    expect(api.markKilled).not.toHaveBeenCalled();
    const reply = interaction.editReply.mock.calls[0]![0];
    expect(reply.content).toBe('Which character killed **Dragon Warden**?');
    const menu = reply.components[0].toJSON().components[0];
    expect(menu.options.map((o: { value: string }) => o.value)).toEqual(['char-1', 'char-2']);
  });

  it('tells unlinked players how to connect their account', async () => {
    const { handler, interaction } = setup(new ApiError(401, { code: 'discord_not_linked' }));

    await handler.handle(interaction as never);

    expect(interaction.editReply.mock.calls[0]![0].content).toContain('/link');
  });

  it('reports an already-marked monster without error', async () => {
    const { handler, interaction } = setup([{ id: 'char-1', name: 'Sir Tester' }], false);

    await handler.handle(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith('ℹ️ **Dragon Warden** was already marked as killed for **Sir Tester**.');
  });
});

function alertMessage(onMyWay: string[], onSite: string[] = []) {
  const base = (buildSpawnMessage(spawnFixture(), { onMyWay: true }).embeds![0] as { toJSON(): APIEmbed }).toJSON();
  const embed = withPresence(base, { onMyWay, onSite }).toJSON();
  return { id: 'alert-1', embeds: [{ title: embed.title, toJSON: () => embed }], edit: vi.fn().mockResolvedValue(undefined) };
}

function presenceIn(payload: { embeds: { toJSON(): APIEmbed }[] }) {
  return presenceOf(payload.embeds[0]!.toJSON());
}

describe('presence buttons', () => {
  function click(list: PresenceList, message: ReturnType<typeof alertMessage>, userId: string, editReply = vi.fn().mockResolvedValue(undefined)) {
    return {
      customId: presenceButtonId(list, 'spawn-1'),
      user: { id: userId },
      message,
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isRepliable: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply,
    };
  }

  it('[OMW] adds the player to "On my way" and a second click removes them', async () => {
    const { handler } = setup([]);

    const join = click('onMyWay', alertMessage(['111']), '999000');
    await handler.handle(join as never);
    expect(join.deferUpdate).toHaveBeenCalled();
    expect(presenceIn(join.editReply.mock.calls[0]![0])).toEqual({ onMyWay: ['111', '999000'], onSite: [] });

    const leave = click('onMyWay', alertMessage(['111', '999000']), '999000');
    await handler.handle(leave as never);
    expect(presenceIn(leave.editReply.mock.calls[0]![0])).toEqual({ onMyWay: ['111'], onSite: [] });
  });

  it('[On site] moves the player from "On my way" to "On site"', async () => {
    const { handler } = setup([]);

    const arrive = click('onSite', alertMessage(['111', '999000']), '999000');
    await handler.handle(arrive as never);

    expect(presenceIn(arrive.editReply.mock.calls[0]![0])).toEqual({ onMyWay: ['111'], onSite: ['999000'] });
  });

  it('keeps every player when many click at once on the same old copy of the alert', async () => {
    const { handler } = setup([]);
    let finishEdit!: () => void;
    const slowEdit = vi.fn(() => new Promise<void>((resolve) => (finishEdit = resolve)));
    const edits = vi.fn().mockResolvedValue(undefined);
    const stale = alertMessage([]);

    const first = handler.handle(click('onMyWay', stale, '1', slowEdit) as never);
    await vi.waitFor(() => expect(slowEdit).toHaveBeenCalled());
    // While that edit is in flight, 20 more players click the same (stale) message.
    const rest = Array.from({ length: 20 }, (_, i) => handler.handle(click('onMyWay', stale, String(i + 2), edits) as never));
    finishEdit();
    await Promise.all([first, ...rest]);

    // One edit for the first click, one more carrying all 20 others.
    expect(edits).toHaveBeenCalledTimes(1);
    const final = presenceIn(edits.mock.calls[0]![0]);
    expect(final.onMyWay).toEqual(Array.from({ length: 21 }, (_, i) => String(i + 1)));
  });
});

describe('[Killed] takes the player off the presence lists', () => {
  it('scenario A: edits the alert after the kill is recorded', async () => {
    const { handler, interaction } = setup([{ id: 'char-1', name: 'Sir Tester' }]);
    const alert = alertMessage(['111', '999000']);
    Object.assign(interaction, { message: alert });

    await handler.handle(interaction as never);

    expect(presenceIn(alert.edit.mock.calls[0]![0])).toEqual({ onMyWay: ['111'], onSite: [] });
  });

  it('scenario A: also takes the player off "On site"', async () => {
    const { handler, interaction } = setup([{ id: 'char-1', name: 'Sir Tester' }]);
    const alert = alertMessage(['111'], ['999000', '222']);
    Object.assign(interaction, { message: alert });

    await handler.handle(interaction as never);

    expect(presenceIn(alert.edit.mock.calls[0]![0])).toEqual({ onMyWay: ['111'], onSite: ['222'] });
  });

  it('scenario A: leaves the alert alone when the player was not on the list', async () => {
    const { handler, interaction } = setup([{ id: 'char-1', name: 'Sir Tester' }]);
    const alert = alertMessage(['111']);
    Object.assign(interaction, { message: alert });

    await handler.handle(interaction as never);

    expect(alert.edit).not.toHaveBeenCalled();
  });

  it('scenario B: finds the alert from the character select and edits it', async () => {
    const { api, handler } = setup([
      { id: 'char-1', name: 'Sir Tester' },
      { id: 'char-2', name: 'Lady Tester' },
    ]);
    const alert = alertMessage(['999000']);
    const select = {
      customId: killSelectId({ ...target, alertMessageId: 'alert-1' }),
      values: ['char-2'],
      user: { id: '999000' },
      channel: { messages: { fetch: vi.fn().mockResolvedValue(alert) } },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
    isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isRepliable: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handler.handle(select as never);

    expect(api.markKilled).toHaveBeenCalledWith('999000', 'char-2', 142);
    expect(select.channel.messages.fetch).toHaveBeenCalledWith('alert-1');
    expect(presenceIn(alert.edit.mock.calls[0]![0])).toEqual({ onMyWay: [], onSite: [] });
  });

  it('does not touch the list when the kill fails', async () => {
    const { handler, interaction, api } = setup([{ id: 'char-1', name: 'Sir Tester' }]);
    api.markKilled.mockRejectedValue(new ApiError(500, null));
    const alert = alertMessage(['999000']);
    Object.assign(interaction, { message: alert });

    await handler.handle(interaction as never);

    expect(alert.edit).not.toHaveBeenCalled();
  });
});

describe('[Gone] button', () => {
  function click(customId: string) {
    const api = { killSpawn: vi.fn().mockResolvedValue(undefined) } as unknown as ApiClient & { killSpawn: ReturnType<typeof vi.fn> };
    const handler = new InteractionHandler(api, {} as MonsterCatalog, 'http://panel');
    const interaction = {
      customId,
      user: { id: '999000' },
      message: alertMessage([]),
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isRepliable: () => true,
      reply: vi.fn().mockResolvedValue(undefined),
      deferUpdate: vi.fn(async function (this: { deferred: boolean }) {
        this.deferred = true;
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    return { api, handler, interaction };
  }

  it('asks for confirmation before closing the report', async () => {
    const { api, handler, interaction } = click(goneButtonId('spawn-1'));

    await handler.handle(interaction as never);

    expect(api.killSpawn).not.toHaveBeenCalled();
    const reply = interaction.reply.mock.calls[0]![0];
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    expect(reply.content).toContain('**Dragon Warden**');
    expect(reply.components[0].toJSON().components[0].custom_id).toBe(goneButtonId('spawn-1', true));
  });

  it('closes the report once confirmed', async () => {
    const { api, handler, interaction } = click(goneButtonId('spawn-1', true));

    await handler.handle(interaction as never);

    expect(api.killSpawn).toHaveBeenCalledWith('999000', 'spawn-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
  });

  it('explains when the report is already closed', async () => {
    const { api, handler, interaction } = click(goneButtonId('spawn-1', true));
    api.killSpawn.mockRejectedValue(new ApiError(409, { detail: 'This report is no longer active.' }));

    await handler.handle(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith({ content: '⚠️ This report is no longer active.', components: [] });
  });
});
