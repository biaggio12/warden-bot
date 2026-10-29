/**
 * Client for the Symfony API. The bot authenticates with BOT_API_TOKEN; calls made
 * on behalf of a player add X-Discord-User-Id so the backend applies that player's
 * permissions (e.g. the character ownership voter).
 */
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

  /** @returns true when the kill was recorded now, false when it already existed */
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
