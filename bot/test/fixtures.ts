import { buildSpawnMessage } from '../src/messages.js';
import type { WardenSpawned } from '../src/events.js';

export function spawnFixture(overrides: Partial<WardenSpawned> = {}): WardenSpawned {
  return {
    spawn_id: 'c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b',
    monster: { id: 142, name: 'Dragon Warden', category: 'Dragons', image_url: 'https://static.wikia.nocookie.net/tibia/images/e/e0/Dragon.gif' },
    server_name: 'Monza',
    city: 'Venore',
    location_description: 'Dragon Lair -2, przy bramce',
    additional_info: null,
    reported_by_discord_user_id: null,
    reported_by_characters: ['Sir Tester'],
    reported_by_name: null,
    discord_guild_id: null,
    created_at: '2026-10-29T12:00:00Z',
    expires_at: '2026-10-29T12:07:00Z',
    ...overrides,
  };
}

/**
 * A stand-in for a discord.js Message holding one of our alerts, shaped like what
 * the library exposes (camelCase component fields, embeds with fields).
 */
export function postedAlert(spawn: WardenSpawned, options: Parameters<typeof buildSpawnMessage>[1] = {}, extra: Record<string, unknown> = {}) {
  const built = buildSpawnMessage(spawn, options);
  const embed = (built.embeds![0] as { toJSON(): { fields: { name: string; value: string }[] } }).toJSON();
  const rows = built.components!.map((row) => (row as { toJSON(): { type: number; components: any[] } }).toJSON());

  return {
    id: 'msg-' + spawn.spawn_id,
    embeds: [{ fields: embed.fields }],
    components: rows.map((row) => ({
      type: row.type,
      components: row.components.map((c) => ({ type: c.type, customId: c.custom_id, disabled: !!c.disabled, toJSON: () => c })),
    })),
    ...extra,
  };
}
