import { useEffect, useRef, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { HistoryEntry, Monster } from '../api/types';
import MonsterCombobox from '../components/MonsterCombobox';
import MonsterImage from '../components/MonsterImage';
import { PageHead } from '../components/PageHead';
import { useAsync } from '../lib/useAsync';

const timeFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const STATUS: Record<HistoryEntry['status'], { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'border-accent text-accent-text' },
  KILLED: { label: 'Killed', className: 'border-ink-2 text-ink-2' },
  EXPIRED: { label: 'Expired', className: 'border-rule text-muted' },
};

function reporterName({ reported_by: by }: HistoryEntry): string {
  if (by.characters.length) return by.discord_name ? `${by.characters.join(', ')} (${by.discord_name})` : by.characters.join(', ');
  return by.discord_name ?? 'a deleted account';
}

/** Every past report, newest first, by world and monster. */
export default function HistoryPage() {
  const worlds = useAsync(endpoints.worlds, []);
  const monsters = useAsync(endpoints.monsters, []);
  const [world, setWorld] = useState('');
  const [monster, setMonster] = useState<Monster | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A filter changed while a page was loading: only the newest request may fill the list.
  const latest = useRef(0);

  async function load(before?: string) {
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const page = await endpoints.history({ serverName: world || undefined, monsterId: monster?.id, before });
      if (request !== latest.current) return;
      setEntries((current) => (before ? [...current, ...page.warden_spawns] : page.warden_spawns));
      setNext(page.next_before);
    } catch (err) {
      if (request === latest.current) setError((err as Error).message);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [world, monster?.id]);

  return (
    <>
      <PageHead
        title="History"
        lead="Every Warden reported, newest first."
        aside={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <label className="sm:w-40">
              <span className="sr-only">World</span>
              <select className="input" value={world} onChange={(e) => setWorld(e.target.value)}>
                <option value="">All worlds</option>
                {(worlds.data ?? []).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:w-64" aria-label="Monster">
              <MonsterCombobox monsters={monsters.data ?? []} value={monster} onChange={setMonster} />
            </div>
            {monster && (
              <button type="button" className="btn-quiet" onClick={() => setMonster(null)}>
                All monsters
              </button>
            )}
          </div>
        }
      />

      {error && <p className="panel mb-4 p-4 text-hp">{error}</p>}

      {!loading && !error && entries.length === 0 ? (
        <p className="border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">No reports{world ? ` on ${world}` : ''}{monster ? ` of ${monster.name}` : ''} yet.</p>
      ) : (
        <ol className={`panel divide-y-2 divide-rule transition-opacity duration-(--dur-short) ${loading ? 'opacity-60' : ''}`}>
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <time dateTime={entry.created_at} className="w-36 shrink-0 text-muted tabular-nums">
                {timeFormat.format(new Date(entry.created_at))}
              </time>
              <MonsterImage src={entry.monster.image_url ?? null} className="h-10 w-10" />
              <span className="min-w-0 flex-1">
                <strong>{entry.monster.name}</strong> <span className="text-muted">{entry.server_name}</span>
                <span className="block truncate text-ink-2">
                  {entry.city ? `${entry.city}, ` : ''}
                  {entry.location_description}
                </span>
                <span className="block text-muted">
                  Reported by <span className="font-semibold text-ink">{reporterName(entry)}</span>
                  {entry.responded > 0 && ` · ${entry.responded} ${entry.responded === 1 ? 'player' : 'players'} went`}
                </span>
              </span>
              <span className={`shrink-0 border-2 px-1.5 text-xs ${STATUS[entry.status].className}`}>{STATUS[entry.status].label}</span>
            </li>
          ))}
        </ol>
      )}

      {next && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn-quiet" disabled={loading} onClick={() => load(next)}>
            {loading ? 'Loading…' : 'Show older'}
          </button>
        </div>
      )}
    </>
  );
}
