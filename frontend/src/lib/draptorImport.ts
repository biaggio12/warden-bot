import type { Monster } from '../api/types';

export interface DraptorImport {
  /** Our ids of the monsters found in the export. */
  monsterIds: number[];
  /** Names from the export that match no monster here. */
  unknown: string[];
}

const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * A TibiaDraptor export (version 1): `sections.echo_wardens` lists the completed monsters.
 * Its ids are TibiaDraptor's own, so the monsters are matched by name.
 */
export function parseDraptorExport(text: string, monsters: Monster[]): DraptorImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const root = data as { version?: unknown; sections?: { echo_wardens?: unknown } } | null;
  const list = root?.sections?.echo_wardens;
  if (!Array.isArray(list)) throw new Error('This does not look like a TibiaDraptor export (no echo_wardens list).');
  if (root?.version !== 1) throw new Error(`Unsupported TibiaDraptor export version: ${String(root?.version)}.`);

  const byName = new Map(monsters.map((m) => [key(m.name), m.id]));
  const monsterIds = new Set<number>();
  const unknown = new Set<string>();
  for (const entry of list) {
    const name = typeof (entry as { name?: unknown })?.name === 'string' ? (entry as { name: string }).name : null;
    if (!name?.trim()) continue;
    const id = byName.get(key(name));
    if (id === undefined) unknown.add(name.trim());
    else monsterIds.add(id);
  }
  return { monsterIds: [...monsterIds], unknown: [...unknown] };
}
