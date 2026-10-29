import type { ApiClient, Monster } from './api.js';

const DEFAULT_TTL_MS = 10 * 60_000;

/** A list fetched from the API and reused for `ttlMs`; a failed refresh keeps the old copy. */
export class CachedList<T> {
  private items: T[] = [];
  private loadedAt = 0;

  constructor(
    private readonly load: () => Promise<T[]>,
    private readonly name: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  async get(forceRefresh = false): Promise<T[]> {
    if (forceRefresh || this.loadedAt === 0 || Date.now() - this.loadedAt > this.ttlMs) {
      try {
        this.items = await this.load();
        this.loadedAt = Date.now();
      } catch (error) {
        console.warn(`[catalog] Could not refresh ${this.name}:`, (error as Error).message);
      }
    }
    return this.items;
  }
}

/** Case-insensitive matches: names starting with the query first, then names containing it. */
export function rankMatches<T>(items: T[], query: string, label: (item: T) => string, limit = 25): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return items.slice(0, limit);
  }
  const starts = items.filter((item) => label(item).toLowerCase().startsWith(needle));
  const contains = items.filter((item) => !label(item).toLowerCase().startsWith(needle) && label(item).toLowerCase().includes(needle));
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Cached dictionaries from the API: monsters (named in replies, searched by /report),
 * worlds and cities (for /report autocomplete).
 */
export class MonsterCatalog {
  private readonly monsters: CachedList<Monster>;
  readonly worlds: CachedList<string>;
  readonly cities: CachedList<string>;
  private readonly known = new Map<number, Monster>();

  constructor(api: ApiClient, ttlMs = DEFAULT_TTL_MS) {
    this.monsters = new CachedList(() => api.getMonsters(), 'monsters', ttlMs);
    this.worlds = new CachedList(() => api.getWorlds(), 'worlds', ttlMs);
    this.cities = new CachedList(() => api.getCities(), 'cities', ttlMs);
  }

  remember(monster: Monster): void {
    this.known.set(monster.id, monster);
  }

  async nameOf(monsterId: number): Promise<string> {
    let monster = this.known.get(monsterId) ?? (await this.monsters.get()).find((m) => m.id === monsterId);
    if (!monster) {
      monster = (await this.monsters.get(true)).find((m) => m.id === monsterId);
    }
    return monster?.name ?? `monster #${monsterId}`;
  }

  async search(query: string, limit = 25): Promise<Monster[]> {
    return rankMatches(await this.monsters.get(), query, (m) => m.name, limit);
  }

  /** Accepts an autocomplete value (monster id) or a typed-in name. */
  async resolve(input: string): Promise<Monster | null> {
    const all = await this.monsters.get();
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      return all.find((m) => m.id === Number(trimmed)) ?? null;
    }
    return all.find((m) => m.name.toLowerCase() === trimmed.toLowerCase()) ?? null;
  }
}
