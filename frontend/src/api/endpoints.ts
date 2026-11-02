import { api } from './client';
import type { AuthResponse, Character, DiscordConfig, DiscordGuild, Me, Monster, Player, Stats, StatsPeriod, WardenSpawn } from './types';

export const endpoints = {
  login: (email: string, password: string) => api<AuthResponse>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string) => api<AuthResponse>('POST', '/auth/register', { email, password }),
  me: () => api<Me>('GET', '/me'),
  discordConfig: () => api<DiscordConfig>('GET', '/auth/discord'),
  /** Logged out: logs in (token returned). Logged in: links Discord to the account (no token). */
  discordAuth: (code: string) => api<AuthResponse | { user: Me }>('POST', '/auth/discord', { code }),
  /** Admins only (403 for everyone else). */
  players: () => api<{ users: Player[] }>('GET', '/admin/users').then((r) => r.users),
  discordLinkCode: () => api<{ code: string; expires_at: string }>('POST', '/me/discord-link-code'),

  worlds: () => api<{ worlds: string[] }>('GET', '/worlds').then((r) => r.worlds),
  cities: () => api<{ cities: string[] }>('GET', '/cities').then((r) => r.cities),
  monsters: () => api<{ monsters: Monster[] }>('GET', '/monsters').then((r) => r.monsters),

  characters: () => api<{ characters: Character[] }>('GET', '/characters').then((r) => r.characters),
  createCharacter: (name: string, serverName: string) =>
    api<Character>('POST', '/characters', { name, server_name: serverName }),
  deleteCharacter: (id: string) => api<void>('DELETE', `/characters/${id}`),

  killedMonsters: (characterId: string, signal?: AbortSignal) =>
    api<{ monster_ids: number[] }>('GET', `/characters/${characterId}/killed-monsters`, undefined, signal).then((r) => r.monster_ids),
  updateKilledMonsters: (characterId: string, add: number[], remove: number[]) =>
    api<{ monster_ids: number[] }>('PUT', `/characters/${characterId}/killed-monsters`, { add, remove }).then((r) => r.monster_ids),

  activeSpawns: (serverName?: string) =>
    api<{ warden_spawns: WardenSpawn[] }>('GET', `/warden-spawns${serverName ? `?server_name=${encodeURIComponent(serverName)}` : ''}`).then(
      (r) => r.warden_spawns,
    ),
  /** The Warden was killed before its time ran out: closes the report and takes the Discord alert down. */
  killSpawn: (id: string) => api<WardenSpawn>('POST', `/warden-spawns/${id}/kill`),
  /** Empty when the player has no linked Discord or the server cannot list them. */
  discordGuilds: (serverName: string) =>
    api<{ enabled: boolean; guilds: DiscordGuild[] }>('GET', `/discord-guilds?server_name=${encodeURIComponent(serverName)}`).then((r) => r.guilds),
  stats: (period: StatsPeriod) => api<Stats>('GET', `/stats?period=${period}`),
  reportSpawn: (payload: {
    monster_id: number;
    server_name: string;
    city: string;
    location_description: string;
    additional_info: string | null;
    ttl_minutes: number;
    /** Only this Discord server gets the alert; null = every server the player is in. */
    discord_guild_id: string | null;
  }) =>
    api<WardenSpawn>('POST', '/warden-spawns', payload),
};
