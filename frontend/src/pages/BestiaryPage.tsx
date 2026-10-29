import { useEffect, useMemo, useState } from 'react';
import type { Monster } from '../api/types';
import { endpoints } from '../api/endpoints';
import { CheckIcon, ChevronIcon, SearchIcon, XIcon } from '../components/Icons';
import MonsterImage from '../components/MonsterImage';
import SyncIndicator from '../components/SyncIndicator';
import { useAsync } from '../lib/useAsync';
import { useKilledMonsters } from '../lib/useKilledMonsters';
import { EmptyState } from './ReportPage';

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

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${value >= 1 ? 'bg-ok' : 'bg-accent'}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Bestiary</h1>
          <p className="mt-1 text-muted">Tick off the monsters you have completed — you will not be pinged about them.</p>
        </div>
        <SyncIndicator status={status} error={error} onRetry={retry} />
      </div>

      <div className="card z-20 space-y-4 p-4 sm:sticky sm:top-[4.5rem] sm:p-5">
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 flex-1 basis-60">
            <span className="sr-only">Active character</span>
            <select className="input font-medium" value={characterId ?? ''} onChange={(e) => setCharacterId(e.target.value)} aria-label="Active character">
              {characters.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.server_name}
                </option>
              ))}
            </select>
          </label>
          <div className="relative min-w-0 flex-1 basis-60">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              className="input pl-10"
              placeholder="Search for a monster or class…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ProgressBar value={total ? done / total : 0} className="h-2 flex-1" />
          <span className="text-sm font-semibold tabular-nums">
            {done}
            <span className="font-normal text-muted"> / {total}</span>
          </span>
        </div>
      </div>

      {groups.length === 0 && !monsters.loading && (
        <p className="py-10 text-center text-sm text-muted">No monsters match “{query}”.</p>
      )}

      {groups.length > 0 && !searching && (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-sm font-medium text-muted hover:text-fg"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(groups.map(([category]) => category)))}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {groups.map(([category, list]) => {
          const ids = list.map((m) => m.id);
          const killedCount = ids.filter((id) => killed.has(id)).length;
          const open = searching || expanded.has(category);
          const complete = killedCount === list.length;
          return (
            <section key={category} className="card overflow-hidden">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                <button
                  type="button"
                  className="group flex min-w-0 flex-1 basis-56 items-center gap-3 text-left"
                  aria-expanded={open}
                  onClick={() => toggle(category)}
                  disabled={searching}
                >
                  <ChevronIcon className={`h-4 w-4 text-subtle transition-transform group-hover:text-fg ${open ? '' : '-rotate-90'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold">
                      {category}
                      {complete && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok">
                          <CheckIcon className="h-3 w-3" />
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 flex items-center gap-3">
                      <ProgressBar value={killedCount / list.length} className="max-w-48 flex-1" />
                      <span className="text-xs text-muted tabular-nums">
                        {killedCount}/{list.length}
                      </span>
                    </span>
                  </span>
                </button>
                <div className="flex w-full gap-2 sm:w-auto">
                  {/* Accessible names keep the full wording ("... w tej kategorii"); the visible text stays short. */}
                  <button
                    type="button"
                    className="btn-ghost flex-1 whitespace-nowrap px-3 py-1.5 text-xs sm:flex-none"
                    disabled={disabled || complete}
                    onClick={() => set(ids, true)}
                    title="Select all in this category"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    Select all<span className="sr-only"> in this category</span>
                  </button>
                  <button
                    type="button"
                    className="btn-ghost flex-1 whitespace-nowrap px-3 py-1.5 text-xs sm:flex-none"
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
                <ul className="grid gap-1.5 border-t border-line bg-raised/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((monster) => {
                    const checked = killed.has(monster.id);
                    return (
                      <li key={monster.id}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-1.5 text-sm transition has-focus-visible:ring-2 has-focus-visible:ring-accent/40 ${
                            checked ? 'border-accent/40 bg-accent-soft font-medium text-fg' : 'border-transparent hover:border-line hover:bg-surface'
                          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) => set([monster.id], e.target.checked)}
                          />
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                              checked ? 'border-accent bg-accent text-on-accent' : 'border-subtle bg-surface'
                            }`}
                          >
                            {checked && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
                          </span>
                          <MonsterImage src={monster.image_url} />
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
    </div>
  );
}
