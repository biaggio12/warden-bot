import { api } from './client';
import type { AdminActionEntry, AdminDuel, DeadClickPair, DuelPair, MyReports, DuelReport, HistoryPage, AlertChannelSettings, AuthResponse, Character, DiscordConfig, DiscordGuild, Me, Monster, Player, PlayerReports, Stats, StatsPeriod, WardenSpawn } from './types';

export const endpoints = {
  login: (email: string, password: string) => api<AuthResponse>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string) => api<AuthResponse>('POST', '/auth/register', { email, password }),
  me: () => api<Me>('GET', '/me'),
  discordConfig: () => api<DiscordConfig>('GET', '/auth/discord'),
  /** Logged out: logs in (token returned). Logged in: links Discord to the account (no token). */
  discordAuth: (code: string) => api<AuthResponse | { user: Me }>('POST', '/auth/discord', { code }),
  /** Admins and moderators only (403 for everyone else). */
  players: () => api<{ users: Player[] }>('GET', '/admin/users').then((r) => r.users),
  /** Admin actions on another player's account; each answers with the updated row. */
  admin: {
    /** `reason`: why, kept in the admin history (optional). */
    block: (id: number, reason?: string) => api<Player>('POST', `/admin/users/${id}/block`, { reason }),
    unblock: (id: number, reason?: string) => api<Player>('POST', `/admin/users/${id}/unblock`, { reason }),
    unlinkDiscord: (id: number) => api<Player>('POST', `/admin/users/${id}/unlink-discord`),
    deleteUser: (id: number, reason?: string) => api<void>('DELETE', `/admin/users/${id}`, { reason }),
    addCharacter: (id: number, name: string, serverName: string) =>
      api<Player>('POST', `/admin/users/${id}/characters`, { name, server_name: serverName }),
    deleteCharacter: (id: number, characterId: string) => api<Player>('DELETE', `/admin/users/${id}/characters/${characterId}`),
    /** A new temporary password, returned once. */
    resetPassword: (id: number) => api<{ password: string; user: Player }>('POST', `/admin/users/${id}/reset-password`),
    /** `from` / `until`: ISO date-times; the stats count only the reports in between (last 7 / 30 days excepted). */
    reports: (id: number, window: { from?: string; until?: string } = {}) => {
      const query = new URLSearchParams(window).toString();
      return api<PlayerReports>('GET', `/admin/users/${id}/reports${query ? `?${query}` : ''}`);
    },
    grantModerator: (id: number) => api<Player>('POST', `/admin/users/${id}/moderator`),
    revokeModerator: (id: number) => api<Player>('DELETE', `/admin/users/${id}/moderator`),
    /** Answers with the reporter's updated row (null when their account is gone). */
    deleteReport: (spawnId: string, reason?: string) => api<{ user: Player | null }>('DELETE', `/admin/reports/${spawnId}`, { reason }),
    actions: () => api<{ actions: AdminActionEntry[] }>('GET', '/admin/actions').then((r) => r.actions),
    /** `from` / `until`: ISO date-times; `userId`: only that player's duels. */
    duels: (filter: { from?: string; until?: string; userId?: number } = {}) => {
      const query = new URLSearchParams();
      if (filter.from) query.set('from', filter.from);
      if (filter.until) query.set('until', filter.until);
      if (filter.userId) query.set('user_id', String(filter.userId));
      const qs = query.toString();
      return api<{ from: string; until: string; duels: AdminDuel[]; truncated: boolean; pairs: DuelPair[] }>('GET', `/admin/duels${qs ? `?${qs}` : ''}`);
    },
    /** Flagged Dead-click and duel pairs of the last `days` days, for the summary at the top of the Players tab. */
    flags: () => api<{ days: number; dead_click_pairs: number; duel_pairs: number }>('GET', '/admin/flags'),
    /** Who closes whose reports with [Dead]; `from` / `until`: ISO date-times, `userId`: pairs with that player. */
    deadClicks: (filter: { from?: string; until?: string; userId?: number } = {}) => {
      const query = new URLSearchParams();
      if (filter.from) query.set('from', filter.from);
      if (filter.until) query.set('until', filter.until);
      if (filter.userId) query.set('user_id', String(filter.userId));
      const qs = query.toString();
      return api<{ from: string; until: string; pairs: DeadClickPair[] }>('GET', `/admin/dead-clicks${qs ? `?${qs}` : ''}`);
    },
    duelDetails: (id: string) => api<{ duel: AdminDuel; reports: DuelReport[] }>('GET', `/admin/duels/${id}`),
    /** Admins only. `refresh` reads the channels from Discord again. */
    alertChannels: (refresh = false) => api<AlertChannelSettings>('GET', `/admin/alert-channels${refresh ? '?refresh=1' : ''}`),
    setAlertChannel: (guildId: string, serverName: string, channelId: string) =>
      api<AlertChannelSettings>('PUT', '/admin/alert-channels', { guild_id: guildId, server_name: serverName, channel_id: channelId }),
    /** Admins only: the bot posts "down for a moment" in every alert channel. */
    botMaintenance: (minutes: number | null, message: string | null) =>
      api<{ back_at: string | null }>('POST', '/admin/bot-maintenance', { minutes, message }),
    /** Admins only: the bot posts "back" in every alert channel. */
    botBackOnline: (message: string | null) => api<unknown>('POST', '/admin/bot-back-online', { message }),
    /** Back to the channel named <prefix><world>. */
    resetAlertChannel: (guildId: string, serverName: string) =>
      api<AlertChannelSettings>('DELETE', `/admin/alert-channels/${guildId}/${encodeURIComponent(serverName)}`),
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>('PUT', '/me/password', { current_password: currentPassword, new_password: newPassword }),
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
  /** `reporterId`: one player's reports; `from` / `until`: ISO date-times. */
  history: (filter: { serverName?: string; monsterId?: number; reporterId?: number; from?: string; until?: string; before?: string }) => {
    const query = new URLSearchParams();
    if (filter.serverName) query.set('server_name', filter.serverName);
    if (filter.monsterId) query.set('monster_id', String(filter.monsterId));
    if (filter.reporterId) query.set('reporter_id', String(filter.reporterId));
    if (filter.from) query.set('from', filter.from);
    if (filter.until) query.set('until', filter.until);
    if (filter.before) query.set('before', filter.before);
    const qs = query.toString();
    return api<HistoryPage>('GET', `/warden-spawns/history${qs ? `?${qs}` : ''}`);
  },
  /** Everyone who has reported a Warden, by name, for the History filter. */
  reporters: () => api<{ reporters: { id: number; name: string }[] }>('GET', '/warden-spawns/reporters').then((r) => r.reporters),
  killSpawn: (id: string) => api<WardenSpawn>('POST', `/warden-spawns/${id}/kill`),
  /** Empty when the player has no linked Discord or the server cannot list them. */
  discordGuilds: (serverName: string) =>
    api<{ enabled: boolean; guilds: DiscordGuild[] }>('GET', `/discord-guilds?server_name=${encodeURIComponent(serverName)}`).then((r) => r.guilds),
  stats: (period: StatsPeriod) => api<Stats>('GET', `/stats?period=${period}`),
  /** My reports in the period, each with its points and why. */
  myReports: (period: StatsPeriod) => api<MyReports>('GET', `/me/reports?period=${period}`),
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
