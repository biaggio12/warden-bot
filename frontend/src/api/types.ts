export interface Monster {
  id: number;
  name: string;
  category: string;
  charm_points: number;
  /** Animated creature GIF on TibiaWiki. */
  image_url: string | null;
}

export interface Character {
  id: string;
  name: string;
  server_name: string;
}

export interface WardenSpawn {
  id: string;
  monster: { id: number; name: string; image_url?: string | null };
  server_name: string;
  city: string | null;
  location_description: string;
  additional_info: string | null;
  /** The reporter's characters on that world and Discord username; never their e-mail. */
  reported_by?: { characters: string[]; discord_name: string | null };
  /** Only the reporter may mark it as gone. */
  is_yours?: boolean;
  status: 'ACTIVE' | 'KILLED' | 'EXPIRED';
  created_at: string;
  expires_at: string;
}

export interface Me {
  id: number;
  /** null for accounts created through Discord without a verified e-mail */
  email: string | null;
  display_name: string;
  discord_linked: boolean;
  discord_username: string | null;
  /** Admins (ADMIN_DISCORD_IDS on the server) also get the Players tab. */
  is_admin?: boolean;
  /** Granted by an admin: the Players tab without the admin-only actions. */
  is_moderator?: boolean;
}

/** One registered account in the admin's Players list. */
export interface Player {
  id: number;
  email: string | null;
  discord_username: string | null;
  discord_linked: boolean;
  /** Admin accounts (and your own) cannot be blocked, unlinked or deleted. */
  is_admin: boolean;
  /** Moderators see the Players tab; only admins change their accounts. */
  is_moderator: boolean;
  /** Cannot log in, report or be pinged. */
  blocked: boolean;
  created_at: string;
  characters: Character[];
  reports: number;
  last_report_at: string | null;
  bestiary_marks: number;
}

/** How one player has reported Wardens (admins only). Reports past their time count as expired. */
export interface PlayerReports {
  total: number;
  last_7_days: number;
  last_30_days: number;
  first_report_at: string | null;
  last_report_at: string | null;
  by_status: { active: number; killed: number; expired: number };
  worlds: { server_name: string; reports: number }[];
  /** The 10 most reported. */
  monsters: { name: string; image_url: string | null; reports: number }[];
  /** The 20 newest. */
  recent: {
    id: string;
    monster: string;
    image_url: string | null;
    server_name: string;
    location: string;
    city: string | null;
    status: 'ACTIVE' | 'KILLED' | 'EXPIRED';
    created_at: string;
  }[];
}

/** One entry of the admin history in the Players tab. */
export interface AdminActionEntry {
  id: number;
  admin: string;
  player: string;
  action:
    | 'block'
    | 'unblock'
    | 'unlink_discord'
    | 'delete'
    | 'add_character'
    | 'delete_character'
    | 'reset_password'
    | 'delete_report'
    | 'grant_moderator'
    | 'revoke_moderator'
    | 'set_alert_channel'
    | 'reset_alert_channel';
  details: string | null;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: Me;
}

export type StatsPeriod = '7d' | '30d' | 'all';

export interface CountRow {
  label: string;
  count: number;
}

export interface Stats {
  period: StatsPeriod;
  totals: { reports: number; reporters: number; monsters: number; active_now: number };
  reports_per_day: { date: string; count: number }[];
  top_monsters: CountRow[];
  top_cities: CountRow[];
  leaderboard: { rank: number; player: string; reports: number; is_you: boolean }[];
  /** Characters with the most monsters marked in the bestiary, all time. */
  bestiary_leaderboard: { rank: number; character: string; server_name: string; killed: number; total: number; is_you: boolean }[];
  you: {
    reports: number;
    rank: number | null;
    reporters: number;
    reports_all_time: number;
    characters: { name: string; server_name: string; killed: number; total: number }[];
  };
}

export interface DiscordConfig {
  enabled: boolean;
  authorize_url: string | null;
}

/** A Discord server a web report can be sent to (the player is in it and it has the world's alert channel). */
export interface DiscordGuild {
  id: string;
  name: string;
}

/** A text channel of a Discord server the bot is in. */
export interface DiscordChannel {
  id: string;
  name: string;
  category: string | null;
}

export interface AlertChannelAssignment {
  guild_id: string;
  server_name: string;
  channel_id: string;
}

/** The admin's alert channel settings: the bot's servers, the worlds and the choices made. */
export interface AlertChannelSettings {
  /** False while the backend has no bot token (it cannot list the servers). */
  enabled: boolean;
  prefix: string;
  worlds: string[];
  servers: { id: string; name: string; channels: DiscordChannel[] }[];
  assignments: AlertChannelAssignment[];
}
