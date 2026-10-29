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
  monster: { id: number; name: string };
  server_name: string;
  city: string | null;
  location_description: string;
  additional_info: string | null;
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
