/**
 * Integration events published by the backend (App\Messenger\JsonEventSerializer).
 */
export interface SpawnedMonster {
  id: number;
  name: string;
  category: string;
  /** Animated creature GIF (TibiaWiki); absent in events from older backends. */
  image_url?: string | null;
}

export interface WardenSpawned {
  spawn_id: string;
  monster: SpawnedMonster;
  server_name: string;
  city: string | null;
  location_description: string;
  additional_info: string | null;
  reported_by_discord_user_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface WardenExpired {
  spawn_id: string;
  monster_id: number;
  server_name: string;
  expires_at: string;
}

export type WardenEvent =
  | { event: 'warden.spawned'; occurred_at: string; data: WardenSpawned }
  | { event: 'warden.expired'; occurred_at: string; data: WardenExpired };

export class InvalidEventError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value === '') {
    throw new InvalidEventError(`Field "${key}" must be a non-empty string`);
  }
  return value;
}

/** Optional text field: missing, null and empty string all become null. */
function optionalString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function expectNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new InvalidEventError(`Field "${key}" must be an integer`);
  }
  return value;
}

export function parseEvent(raw: string): WardenEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new InvalidEventError('Body is not valid JSON');
  }

  if (!isObject(payload) || !isObject(payload.data)) {
    throw new InvalidEventError('Missing "data" object');
  }
  const { data } = payload;
  const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : new Date().toISOString();

  switch (payload.event) {
    case 'warden.spawned': {
      if (!isObject(data.monster)) {
        throw new InvalidEventError('Missing "monster" object');
      }
      return {
        event: 'warden.spawned',
        occurred_at: occurredAt,
        data: {
          spawn_id: expectString(data, 'spawn_id'),
          monster: {
            id: expectNumber(data.monster, 'id'),
            name: expectString(data.monster, 'name'),
            category: expectString(data.monster, 'category'),
            image_url: optionalString(data.monster, 'image_url'),
          },
          server_name: expectString(data, 'server_name'),
          city: optionalString(data, 'city'),
          location_description: expectString(data, 'location_description'),
          additional_info: optionalString(data, 'additional_info'),
          reported_by_discord_user_id: optionalString(data, 'reported_by_discord_user_id'),
          created_at: expectString(data, 'created_at'),
          expires_at: expectString(data, 'expires_at'),
        },
      };
    }
    case 'warden.expired':
      return {
        event: 'warden.expired',
        occurred_at: occurredAt,
        data: {
          spawn_id: expectString(data, 'spawn_id'),
          monster_id: expectNumber(data, 'monster_id'),
          server_name: expectString(data, 'server_name'),
          expires_at: expectString(data, 'expires_at'),
        },
      };
    default:
      throw new InvalidEventError(`Unknown event type "${String(payload.event)}"`);
  }
}
