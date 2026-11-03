import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { AlertChannels } from '../src/alertChannels.js';
import { AlertPresence } from '../src/alertPresence.js';
import { ApiError, type ApiClient } from '../src/api.js';
import { InteractionHandler } from '../src/interactions.js';
import { MonsterCatalog } from '../src/monsterCatalog.js';

function setup(
  characters: { id: string; name: string; server_name: string }[] | Error = [{ id: 'c1', name: 'Sir Tester', server_name: 'Monza' }],
  assignments: { guild_id: string; server_name: string; channel_id: string }[] = [],
) {
  const api = {
    getMonsters: vi.fn().mockResolvedValue([
      { id: 142, name: 'Dragon Warden', category: 'Dragons' },
      { id: 7, name: 'Hydra', category: 'Dragons' },
      { id: 9, name: 'Dragon Lord', category: 'Dragons' },
    ]),
    getCities: vi.fn().mockResolvedValue(['Thais', 'Venore', 'Edron']),
    getWorlds: vi.fn().mockResolvedValue(['Antica', 'Monza', 'Secura']),
    getCharacters: characters instanceof Error ? vi.fn().mockRejectedValue(characters) : vi.fn().mockResolvedValue(characters),
    reportSpawn: vi.fn().mockResolvedValue({
      id: 's1',
      monster: { id: 142, name: 'Dragon Warden' },
      server_name: 'Monza',
      city: 'Venore',
      location_description: 'Dragon Lair -2',
      expires_at: '2026-10-29T12:07:00Z',
    }),
  };
  const channels = new AlertChannels(async () => assignments, 'wardens-');
  const handler = new InteractionHandler(
    api as unknown as ApiClient,
    new MonsterCatalog(api as unknown as ApiClient),
    'http://panel',
    'wardens-',
    new AlertPresence(),
    channels,
  );
  return { api, handler };
}

function command(options: Record<string, string | number | undefined>, channelName = 'ogolny', channelId = 'chan-1') {
  return {
    commandName: 'warden',
    user: { id: '999000' },
    guildId: 'guild-1',
    channel: { id: channelId, name: channelName },
    deferred: false,
    replied: false,
    options: {
      getString: (name: string, required?: boolean) => {
        const value = options[name];
        if (value === undefined && required) throw new Error(`missing ${name}`);
        return (value as string | undefined) ?? null;
      },
      getInteger: (name: string) => (options[name] as number | undefined) ?? null,
    },
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isRepliable: () => true,
    deferReply: vi.fn(async function (this: { deferred: boolean }) {
      this.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

const required = { monster: '142', city: 'venore', location: 'Dragon Lair -2' };

describe('/warden', () => {
  it('reports the Warden as the linked player with the default TTL', async () => {
    const { api, handler } = setup();
    const interaction = command(required);

    await handler.handle(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(api.reportSpawn).toHaveBeenCalledWith('999000', {
      monster_id: 142,
      server_name: 'Monza',
      city: 'Venore',
      location_description: 'Dragon Lair -2',
      additional_info: null,
      ttl_minutes: 8,
      discord_guild_id: 'guild-1',
    });
    expect(interaction.editReply.mock.calls[0]![0]).toContain('Reported **Dragon Warden** on **Monza**');
    expect(interaction.editReply.mock.calls[0]![0]).toContain('will appear in #wardens-monza');
  });

  it('accepts a typed-in monster name, TTL and additional info', async () => {
    const { api, handler } = setup();

    await handler.handle(command({ ...required, monster: 'hydra', time: 4, info: 'Dwie osoby czekają' }) as never);

    expect(api.reportSpawn).toHaveBeenCalledWith('999000', expect.objectContaining({ monster_id: 7, ttl_minutes: 4, additional_info: 'Dwie osoby czekają' }));
  });

  it('takes the world from the #wardens-<world> channel name', async () => {
    const { api, handler } = setup([
      { id: 'c1', name: 'A', server_name: 'Monza' },
      { id: 'c2', name: 'B', server_name: 'Secura' },
    ]);

    await handler.handle(command(required, 'wardens-secura') as never);

    expect(api.reportSpawn).toHaveBeenCalledWith('999000', expect.objectContaining({ server_name: 'Secura' }));
    expect(api.getCharacters).not.toHaveBeenCalled();
  });

  it('takes the world from a channel chosen on the website and names that channel', async () => {
    const { api, handler } = setup([{ id: 'c1', name: 'A', server_name: 'Monza' }], [
      { guild_id: 'guild-1', server_name: 'Secura', channel_id: 'chan-7' },
    ]);
    api.reportSpawn.mockResolvedValue({
      id: 's1',
      monster: { id: 142, name: 'Dragon Warden' },
      server_name: 'Secura',
      city: 'Venore',
      location_description: 'Dragon Lair -2',
      expires_at: '2026-10-29T12:07:00Z',
    });
    const interaction = command(required, 'alerts', 'chan-7');

    await handler.handle(interaction as never);

    expect(api.reportSpawn).toHaveBeenCalledWith('999000', expect.objectContaining({ server_name: 'Secura', discord_guild_id: 'guild-1' }));
    expect(api.getCharacters).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('will appear in <#chan-7>'));
  });

  it('outside a #wardens-<world> channel, picks the world with most of the player\'s characters', async () => {
    const { api, handler } = setup([
      { id: 'c1', name: 'A', server_name: 'Monza' },
      { id: 'c2', name: 'B', server_name: 'Secura' },
      { id: 'c3', name: 'C', server_name: 'Secura' },
    ]);

    await handler.handle(command(required) as never);

    expect(api.reportSpawn).toHaveBeenCalledWith('999000', expect.objectContaining({ server_name: 'Secura' }));
  });

  it('breaks a tie alphabetically', async () => {
    const { api, handler } = setup([
      { id: 'c1', name: 'A', server_name: 'Secura' },
      { id: 'c2', name: 'B', server_name: 'Antica' },
    ]);

    await handler.handle(command(required) as never);

    expect(api.reportSpawn).toHaveBeenCalledWith('999000', expect.objectContaining({ server_name: 'Antica' }));
  });

  it('explains what to do when the player has no characters', async () => {
    const { api, handler } = setup([]);
    const interaction = command(required);

    await handler.handle(interaction as never);

    expect(api.reportSpawn).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0]![0].content).toContain('You have no characters yet');
  });

  it('has no world option', async () => {
    const { reportCommand } = await import('../src/reportCommand.js');
    expect(reportCommand.toJSON().options!.map((o) => o.name)).toEqual(['monster', 'city', 'location', 'time', 'info']);
  });

  it('rejects unknown monsters and cities before calling the API', async () => {
    const { api, handler } = setup();
    const badMonster = command({ ...required, monster: 'Unicorn' });
    const badCity = command({ ...required, city: 'Atlantis' });

    await handler.handle(badMonster as never);
    await handler.handle(badCity as never);

    expect(api.reportSpawn).not.toHaveBeenCalled();
    expect(badMonster.editReply.mock.calls[0]![0].content).toContain('Unknown monster "Unicorn"');
    expect(badCity.editReply.mock.calls[0]![0].content).toContain('Unknown city "Atlantis"');
  });

  it('shows validation errors from the API', async () => {
    const { api, handler } = setup();
    api.reportSpawn.mockRejectedValue(new ApiError(422, { violations: [{ property_path: 'location_description', title: 'Za krótko.' }] }));
    const interaction = command(required);

    await handler.handle(interaction as never);

    expect(interaction.editReply.mock.calls[0]![0].content).toBe('⚠️ Za krótko.');
  });

  it('tells unlinked players to use /link', async () => {
    const { handler } = setup(new ApiError(401, { code: 'discord_not_linked' }));
    const interaction = command(required);

    await handler.handle(interaction as never);

    expect(interaction.editReply.mock.calls[0]![0].content).toContain('/link');
  });
});

describe('/warden autocomplete', () => {
  function autocomplete(name: string, value: string) {
    return {
      commandName: 'warden',
      user: { id: '999000' },
      options: { getFocused: () => ({ name, value }) },
      isAutocomplete: () => true,
      respond: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('suggests monsters by name, prefix matches first', async () => {
    const { handler } = setup();
    const interaction = autocomplete('monster', 'dra');

    await handler.handle(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'Dragon Warden (Dragons)', value: '142' },
      { name: 'Dragon Lord (Dragons)', value: '9' },
      { name: 'Hydra (Dragons)', value: '7' },
    ]);
  });

  it('suggests cities', async () => {
    const { handler } = setup();
    const interaction = autocomplete('city', 'ed');

    await handler.handle(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([{ name: 'Edron', value: 'Edron' }]);
  });

});
