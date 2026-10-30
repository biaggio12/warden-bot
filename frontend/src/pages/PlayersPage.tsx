import { useMemo, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { Player } from '../api/types';
import { PageHead } from '../components/PageHead';
import { useAsync } from '../lib/useAsync';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function matches(player: Player, query: string): boolean {
  const haystack = [player.email, player.discord_username, ...player.characters.map((c) => `${c.name} ${c.server_name}`)];
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

/** Admins only: every registered account, newest first, with what it has done so far. */
export default function PlayersPage() {
  const players = useAsync(endpoints.players, []);
  const [query, setQuery] = useState('');
  const list = players.data;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !list || !q ? list : list.filter((p) => matches(p, q));
  }, [list, query]);

  return (
    <>
      <PageHead
        title="Players"
        lead={list ? `${plural(list.length, 'account')}, newest first.` : 'Everyone who has signed up.'}
        aside={
          <label className="w-full sm:w-72">
            <span className="sr-only">Search players</span>
            <input
              type="search"
              className="input"
              placeholder="Search e-mail, Discord, character"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        }
      />

      {players.error && <p className="panel p-4 text-hp">{players.error.message}</p>}
      {players.loading && !list && <p className="text-muted">Loading players…</p>}

      {visible && (
        <section className="panel" aria-label="Registered players">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_8rem_9rem] gap-4 border-b-3 border-outline px-5 py-3 text-sm text-muted md:grid">
            <span>Account</span>
            <span>Characters</span>
            <span>Joined</span>
            <span>Activity</span>
          </div>
          {visible.length === 0 ? (
            <p className="px-5 py-6 text-muted">{query ? 'No player matches that search.' : 'Nobody has signed up yet.'}</p>
          ) : (
            <ul>
              {visible.map((player) => (
                <PlayerRow key={player.id} player={player} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function PlayerRow({ player }: { player: Player }) {
  return (
    <li className="grid gap-x-4 gap-y-2 border-t-2 border-rule px-5 py-4 first:border-t-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_8rem_9rem]">
      <div className="min-w-0">
        <p className="truncate font-semibold" title={player.email ?? undefined}>
          {player.email ?? <span className="text-muted">No e-mail</span>}
        </p>
        <p className="truncate text-sm">
          {player.discord_linked ? (
            <span className="text-ink-2">Discord {player.discord_username ?? 'linked'}</span>
          ) : (
            <span className="text-muted">Discord not linked</span>
          )}
        </p>
      </div>
      <p className="min-w-0 text-sm text-ink-2">
        <span className="text-muted md:hidden">Characters: </span>
        {player.characters.length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          player.characters.map((c) => `${c.name} (${c.server_name})`).join(', ')
        )}
      </p>
      <p className="text-sm tabular-nums">
        <span className="text-muted md:hidden">Joined </span>
        {formatDate(player.created_at)}
      </p>
      <div className="text-sm tabular-nums">
        <p>{plural(player.reports, 'report')}</p>
        {player.last_report_at && <p className="text-muted">last {formatDate(player.last_report_at)}</p>}
        <p>{player.bestiary_marks} in bestiary</p>
      </div>
    </li>
  );
}
