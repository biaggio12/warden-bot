/**
 * Client for the Symfony API. The bot authenticates with BOT_API_TOKEN; calls made
 * on behalf of a player add X-Discord-User-Id so the backend applies that player's
 * permissions (e.g. the character ownership voter).
 */
import type { ChannelAssignment } from './alertChannels.js';
import type { DailySummaryData } from './dailySummary.js';
import type { Presence } from './messages.js';

export interface CharacterRef {
  id: string;
  name: string;
  server_name?: string;
}

export interface Recipient {
  discord_user_id: string;
  characters: CharacterRef[];
}

export interface Monster {
  id: number;
  name: string;
  category: string;
}

export interface SpawnReport {
  monster_id: number;
  server_name: string;
  city: string;
  location_description: string;
  additional_info: string | null;
  ttl_minutes: number;
  /** The server /warden was used in; the alert is posted there only. */
  discord_guild_id: string | null;
}

export interface ReportedSpawn {
  id: string;
  monster: { id: number; name: string };
  server_name: string;
  city: string | null;
  location_description: string;
  expires_at: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { detail?: string; code?: string; violations?: { property_path: string; title: string }[] } | null,
  ) {
    super(problem?.detail ?? `API responded with HTTP ${status}`);
  }

  get isDiscordNotLinked(): boolean {
    return this.status === 401 && this.problem?.code === 'discord_not_linked';
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly botToken: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async getRecipients(spawnId: string): Promise<Recipient[]> {
    const body = await this.request<{ recipients: Recipient[] }>('GET', `/internal/warden-spawns/${encodeURIComponent(spawnId)}/recipients`);
    return body.recipients;
  }

  /** The full [OMW] / [On site] lists of one alert (empty for one nobody clicked). */
  async getPresence(spawnId: string, messageId: string): Promise<Presence> {
    const body = await this.request<{ on_my_way: string[]; on_site: string[] }>('GET', this.presencePath(spawnId, messageId));
    return { onMyWay: body.on_my_way, onSite: body.on_site };
  }

  async savePresence(spawnId: string, messageId: string, presence: Presence): Promise<void> {
    await this.request('PUT', this.presencePath(spawnId, messageId), { on_my_way: presence.onMyWay, on_site: presence.onSite });
  }

  private presencePath(spawnId: string, messageId: string): string {
    return `/internal/warden-spawns/${encodeURIComponent(spawnId)}/presence/${encodeURIComponent(messageId)}`;
  }

  /** The channels admins chose on the website per server and world. */
  async getAlertChannels(): Promise<ChannelAssignment[]> {
    return (await this.request<{ alert_channels: ChannelAssignment[] }>('GET', '/internal/alert-channels')).alert_channels;
  }

  /** What happened on each world in the 24 hours before `until`. */
  async getDailySummary(until: Date): Promise<DailySummaryData> {
    return this.request('GET', `/internal/daily-summary?${new URLSearchParams({ until: until.toISOString() })}`);
  }

  async getMonsters(): Promise<Monster[]> {
    return (await this.request<{ monsters: Monster[] }>('GET', '/monsters')).monsters;
  }

  /** The player's characters, optionally only those on one world. */
  async getCharacters(discordUserId: string, serverName?: string): Promise<CharacterRef[]> {
    const query = serverName ? `?${new URLSearchParams({ server_name: serverName })}` : '';
    const body = await this.request<{ characters: CharacterRef[] }>('GET', `/characters${query}`, undefined, discordUserId);
    return body.characters;
  }

  async getWorlds(): Promise<string[]> {
    return (await this.request<{ worlds: string[] }>('GET', '/worlds')).worlds;
  }

  async getCities(): Promise<string[]> {
    return (await this.request<{ cities: string[] }>('GET', '/cities')).cities;
  }

  /** Reports a Warden as the linked player; the backend then publishes the alert event. */
  async reportSpawn(discordUserId: string, report: SpawnReport): Promise<ReportedSpawn> {
    return this.request('POST', '/warden-spawns', report, discordUserId);
  }

  /** Closes the report early (the Warden is dead); the backend then publishes warden.killed. */
  async killSpawn(discordUserId: string, spawnId: string): Promise<void> {
    await this.request('POST', `/warden-spawns/${encodeURIComponent(spawnId)}/kill`, undefined, discordUserId);
  }

  /** @returns true when the kill was recorded now, false when it already existed */
  /** The monsters one of the player's characters has in its bestiary. */
  async getKilledMonsterIds(discordUserId: string, characterId: string): Promise<number[]> {
    const body = await this.request<{ monster_ids: number[] }>('GET', `/characters/${encodeURIComponent(characterId)}/killed-monsters`, undefined, discordUserId);
    return body.monster_ids;
  }

  async markKilled(discordUserId: string, characterId: string, monsterId: number): Promise<boolean> {
    const { status } = await this.requestWithStatus(
      'POST',
      `/characters/${encodeURIComponent(characterId)}/killed-monsters`,
      { monster_id: monsterId },
      discordUserId,
    );
    return status === 201;
  }

  async linkDiscord(code: string, discordUserId: string): Promise<{ display_name: string }> {
    return this.request('POST', '/internal/discord-links', { code, discord_user_id: discordUserId });
  }

  private async request<T>(method: string, path: string, body?: unknown, actingDiscordUserId?: string): Promise<T> {
    return (await this.requestWithStatus<T>(method, path, body, actingDiscordUserId)).data;
  }

  private async requestWithStatus<T>(
    method: string,
    path: string,
    body?: unknown,
    actingDiscordUserId?: string,
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.botToken}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (actingDiscordUserId !== undefined) {
      headers['X-Discord-User-Id'] = actingDiscordUserId;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    const data = text === '' ? null : (JSON.parse(text) as unknown);

    if (!response.ok) {
      throw new ApiError(response.status, data as ApiError['problem']);
    }
    return { status: response.status, data: data as T };
  }
}
