import { useEffect, useMemo, useState } from 'react';
import type { Monster } from '../api/types';
import { endpoints } from '../api/endpoints';
import { CheckIcon, ChevronIcon, SearchIcon, XIcon } from '../components/Icons';
import MonsterImage from '../components/MonsterImage';
import SegmentBar from '../components/SegmentBar';
import SyncIndicator from '../components/SyncIndicator';
import { useAsync } from '../lib/useAsync';
import { useKilledMonsters } from '../lib/useKilledMonsters';
import { EmptyState, PageHead } from '../components/PageHead';

const SELECTED_KEY = 'warden-tracker.bestiary-character';

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export default function BestiaryPage() {
  const characters = useAsync(endpoints.characters, []);
  const monsters = useAsync(endpoints.monsters, []);
  const [characterId, setCharacterId] = useState<string | null>(readSelected);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Fall back to the first character when the remembered one no longer exists.
  useEffect(() => {
    const list = characters.data;
    if (list && !list.some((c) => c.id === characterId)) setCharacterId(list[0]?.id ?? null);
  }, [characters.data, characterId]);

  useEffect(() => {
    try {
      if (characterId) localStorage.setItem(SELECTED_KEY, characterId);
    } catch {
      // ignore
    }
  }, [characterId]);

  const { killed, status, error, set, retry } = useKilledMonsters(characters.data ? characterId : null);

  const searching = query.trim() !== '';
  const groups = useMemo(() => {
    const needle = normalize(query.trim());
    const byCategory = new Map<string, Monster[]>();
    for (const monster of monsters.data ?? []) {
      if (needle && !normalize(monster.name).includes(needle) && !normalize(monster.category).includes(needle)) continue;
      const list = byCategory.get(monster.category) ?? [];
      list.push(monster);
      byCategory.set(monster.category, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [monsters.data, query]);

  const total = monsters.data?.length ?? 0;
  const done = monsters.data?.filter((m) => killed.has(m.id)).length ?? 0;
  const disabled = status === 'loading' || !characterId;
  const allOpen = groups.length > 0 && groups.every(([category]) => expanded.has(category));

  function toggle(category: string) {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  if (characters.data?.length === 0) {
    return <EmptyState title="Add a character first" text="Each character has its own bestiary." href="#characters" action="Go to characters" />;
  }

  return (
    <>
      <PageHead title="Bestiary" lead="Tick off the monsters you have completed. You will not be pinged about them." />

      <div className="panel z-(--z-sticky) mb-8 p-4 sm:sticky sm:top-[4.5rem] sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="min-w-0 flex-1 basis-56">
            <span className="sr-only">Active character</span>
            <select className="input font-semibold" value={characterId ?? ''} onChange={(e) => setCharacterId(e.target.value)} aria-label="Active character">
              {characters.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.server_name})
                </option>
              ))}
            </select>
          </label>
          <div className="relative min-w-0 flex-1 basis-56">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search for a monster or class…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </div>
          <SyncIndicator status={status} error={error} onRetry={retry} />
        </div>
        <div className="mt-4 flex items-center gap-4">
          <span className="text-2xl leading-none font-bold whitespace-nowrap tabular-nums">
            {done} <span className="text-muted">/ {total}</span>
          </span>
          <SegmentBar value={total ? done / total : 0} kind="xp" segments={20} className="flex-1" />
        </div>
      </div>

      {groups.length === 0 && !monsters.loading && <p className="py-10 text-muted">No monsters match “{query}”.</p>}

      {groups.length > 0 && !searching && (
        <div className="mb-3 flex justify-end">
          <button type="button" className="btn-quiet" onClick={() => setExpanded(allOpen ? new Set() : new Set(groups.map(([category]) => category)))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      <div className="space-y-4">
        {groups.map(([category, list]) => {
          const ids = list.map((m) => m.id);
          const killedCount = ids.filter((id) => killed.has(id)).length;
          const open = searching || expanded.has(category);
          const complete = killedCount === list.length;
          return (
            <section key={category} className="panel">
              <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <button
                  type="button"
                  className="group flex min-h-11 min-w-0 flex-1 basis-64 items-center gap-3 text-left"
                  aria-expanded={open}
                  onClick={() => toggle(category)}
                  disabled={searching}
                >
                  <ChevronIcon className={`h-5 w-5 text-muted transition-transform duration-(--dur-short) group-hover:text-ink ${open ? '' : '-rotate-90'}`} />
                  <span className="w-36 shrink-0 truncate text-lg font-semibold">{category}</span>
                  <SegmentBar value={killedCount / list.length} kind="xp" className="max-w-56 flex-1" />
                  <span className={`w-16 shrink-0 text-right font-bold tabular-nums ${complete ? 'text-xp' : 'text-muted'}`}>
                    {killedCount}/{list.length}
                  </span>
                </button>
                <div className="flex w-full gap-1 sm:w-auto">
                  {/* Accessible names keep the full wording ("... in this category"); the visible text stays short. */}
                  <button
                    type="button"
                    className="btn-quiet flex-1 whitespace-nowrap sm:flex-none"
                    disabled={disabled || complete}
                    onClick={() => set(ids, true)}
                    title="Select all in this category"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    Select all<span className="sr-only"> in this category</span>
                  </button>
                  <button
                    type="button"
                    className="btn-quiet flex-1 whitespace-nowrap sm:flex-none"
                    disabled={disabled || killedCount === 0}
                    onClick={() => set(ids, false)}
                    title="Deselect all in this category"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                    Deselect all<span className="sr-only"> in this category</span>
                  </button>
                </div>
              </header>
              {open && (
                <ul className="grid grid-cols-1 gap-1 border-t-3 border-outline bg-paper p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((monster) => {
                    const checked = killed.has(monster.id);
                    return (
                      <li key={monster.id}>
                        <label
                          className={`flex min-h-12 cursor-pointer items-center gap-3 px-2 py-1 text-sm transition-colors duration-(--dur-micro) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                            checked ? 'bg-accent-soft font-semibold' : 'hover:bg-paper-3'
                          } ${disabled ? 'cursor-not-allowed opacity-55' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) => set([monster.id], e.target.checked)}
                          />
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center outline-2 outline-edge ${checked ? 'bg-accent text-accent-ink outline-outline' : 'bg-paper-2'}`}>
                            {checked && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
                          </span>
                          <MonsterImage src={monster.image_url} className="h-10 w-10" />
                          <span className="truncate">{monster.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
