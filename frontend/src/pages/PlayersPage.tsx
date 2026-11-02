import { useMemo, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { Player } from '../api/types';
import AddCharacterForm from '../components/AddCharacterForm';
import { ChevronIcon, TrashIcon } from '../components/Icons';
import { PageHead } from '../components/PageHead';
import { useToast } from '../components/Toast';
import { useAsync } from '../lib/useAsync';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function matches(player: Player, query: string): boolean {
  const haystack = [player.email, player.discord_username, ...player.characters.map((c) => `${c.name} ${c.server_name}`)];
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

/** Admins only: every registered account, newest first, with what it has done so far, and the tools to manage it. */
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
                <PlayerRow
                  key={player.id}
                  player={player}
                  onChange={(next) => players.setData((all) => all?.map((p) => (p.id === next.id ? next : p)) ?? all)}
                  onDeleted={() => players.setData((all) => all?.filter((p) => p.id !== player.id) ?? all)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function nameOf(player: Player): string {
  return player.email ?? player.discord_username ?? `account #${player.id}`;
}

type RowProps = {
  player: Player;
  onChange: (player: Player) => void;
  onDeleted: () => void;
};

function PlayerRow({ player, onChange, onDeleted }: RowProps) {
  const [open, setOpen] = useState(false);
  const panelId = `manage-${player.id}`;

  return (
    <li className={`border-t-2 border-rule first:border-t-0 ${player.blocked ? 'bg-hp/5' : ''}`}>
      <div className="grid gap-x-4 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_8rem_9rem]">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 font-semibold" title={player.email ?? undefined}>
            <span className="truncate">{player.email ?? <span className="text-muted">No e-mail</span>}</span>
            {player.is_admin && <span className="shrink-0 border-2 border-accent px-1.5 text-xs text-accent-text">Admin</span>}
            {player.blocked && <span className="shrink-0 border-2 border-hp px-1.5 text-xs text-hp">Blocked</span>}
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
          <button type="button" className="btn-quiet -ml-2 text-ink" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
            Manage
            <ChevronIcon className={`h-4 w-4 transition-transform duration-(--dur-micro) ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && <ManagePanel id={panelId} player={player} onChange={onChange} onDeleted={onDeleted} />}
    </li>
  );
}

/** What an admin may change: characters of anyone; block, unlink and delete only for players who are not admins. */
function ManagePanel({ id, player, onChange, onDeleted }: RowProps & { id: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = nameOf(player);

  async function run(action: () => Promise<Player | void>, done: string) {
    setBusy(true);
    try {
      const next = await action();
      if (next) onChange(next);
      toast(done, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    try {
      await endpoints.admin.deleteUser(player.id);
      toast(`Deleted ${name}.`, 'success');
      onDeleted();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <div id={id} className="grid gap-6 border-t-2 border-dashed border-rule bg-paper px-5 py-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label={`Characters of ${name}`} className="min-w-0 space-y-3">
        <h3 className="label">Characters</h3>
        {player.characters.length === 0 ? (
          <p className="text-sm text-muted">No characters.</p>
        ) : (
          <ul className="space-y-1">
            {player.characters.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 border-b-2 border-rule py-1 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{c.name}</span> <span className="text-muted">{c.server_name}</span>
                </span>
                <button
                  type="button"
                  className="btn-quiet min-w-10 justify-center hover:text-hp"
                  aria-label={`Delete ${c.name}`}
                  title={`Delete ${c.name}`}
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Delete ${c.name} together with their bestiary?`) &&
                    run(() => endpoints.admin.deleteCharacter(player.id, c.id), `Deleted ${c.name}.`)
                  }
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddCharacterForm
          create={async (characterName, server) => {
            const next = await endpoints.admin.addCharacter(player.id, characterName, server);
            onChange(next);
            return (
              next.characters.find((c) => c.name.toLowerCase() === characterName.toLowerCase()) ?? {
                id: '',
                name: characterName,
                server_name: server,
              }
            );
          }}
          onAdded={() => undefined}
        />
      </section>

      <section aria-label={`Account of ${name}`} className="space-y-3">
        <h3 className="label">Account</h3>
        {player.is_admin ? (
          <p className="text-sm text-muted">Admin accounts cannot be blocked, unlinked or deleted here.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {player.blocked ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => run(() => endpoints.admin.unblock(player.id), `Unblocked ${name}.`)}
              >
                Unblock
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => endpoints.admin.block(player.id), `Blocked ${name}.`)}>
                Block
              </button>
            )}
            <p className="text-xs text-muted">Blocked: no login, no reports, no pings. Can be undone.</p>
            {player.discord_linked && (
              <button
                type="button"
                className="btn"
                disabled={busy || player.blocked}
                title={player.blocked ? 'Unblock first' : undefined}
                onClick={() => run(() => endpoints.admin.unlinkDiscord(player.id), `Unlinked Discord of ${name}.`)}
              >
                Unlink Discord
              </button>
            )}
            {confirmDelete ? (
              <div className="space-y-2 border-3 border-hp p-3">
                <p className="text-sm">
                  Delete <strong>{name}</strong> with their characters and bestiary? Their reports stay in the stats. This cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-quiet" disabled={busy} onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn bg-hp text-hp-ink hover:bg-hp" disabled={busy} onClick={deleteAccount}>
                    Yes, delete
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-quiet justify-center hover:text-hp" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <TrashIcon />
                Delete account
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
