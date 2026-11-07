import { describe, expect, it } from 'vitest';
import type { Monster } from '../api/types';
import { parseDraptorExport } from './draptorImport';

const monsters = [
  { id: 1, name: 'Azure Frog' },
  { id: 6, name: 'Green Frog' },
  { id: 9, name: 'Dragon Lord' },
] as Monster[];

const exportOf = (echo: unknown, version: unknown = 1) =>
  JSON.stringify({ version, exported_at: '2026-11-04T02:26:57-06:00', sections: { echo_wardens: echo } });

describe('parseDraptorExport', () => {
  it('matches the monsters by name, not by TibiaDraptor id', () => {
    const result = parseDraptorExport(exportOf([{ id: 2, name: 'Green Frog' }, { id: 3, name: 'Azure Frog' }]), monsters);
    expect(result.monsterIds.sort()).toEqual([1, 6]);
    expect(result.unknown).toEqual([]);
  });

  it('ignores case and extra spaces, skips duplicates and lists unknown names', () => {
    const result = parseDraptorExport(exportOf([{ name: ' dragon  lord ' }, { name: 'Dragon Lord' }, { name: 'Ferumbras' }, { id: 5 }]), monsters);
    expect(result.monsterIds).toEqual([9]);
    expect(result.unknown).toEqual(['Ferumbras']);
  });

  it('rejects files that are not a TibiaDraptor export', () => {
    expect(() => parseDraptorExport('not json', monsters)).toThrow(/not valid JSON/);
    expect(() => parseDraptorExport('{"version":1,"sections":{}}', monsters)).toThrow(/TibiaDraptor export/);
    expect(() => parseDraptorExport(exportOf([], 2), monsters)).toThrow(/version: 2/);
  });
});
