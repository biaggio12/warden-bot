import { useMemo, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { AdminActionEntry, Player, PlayerReports } from '../api/types';
import AlertChannelsSection from '../components/AlertChannelsSection';
import AddCharacterForm from '../components/AddCharacterForm';
import { ChevronIcon, TrashIcon } from '../components/Icons';
import MonsterImage from '../components/MonsterImage';
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

/**
 * Admins and moderators: every registered account, newest first, with what it has done so
 * far, and the tools to manage it. Moderators get no admin-only actions and leave staff
 * accounts alone (the backend enforces the same).
 */
export default function PlayersPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const players = useAsync(endpoints.players, []);
  const history = useAsync(endpoints.admin.actions, []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'reports'>('newest');
  const list = players.data;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = !list || !q ? list : list.filter((p) => matches(p, q));
    // Most reports first; ties by the latest report. The API already sends newest first.
    return found && sort === 'reports'
      ? [...found].sort((a, b) => b.reports - a.reports || (b.last_report_at ?? '').localeCompare(a.last_report_at ?? ''))
      : found;
  }, [list, query, sort]);

  return (
    <>
      <PageHead
        title="Players"
        lead={list ? `${plural(list.length, 'account')}, ${sort === 'reports' ? 'most reports' : 'newest'} first.` : 'Everyone who has signed up.'}
        aside={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <label className="sm:w-40">
              <span className="sr-only">Sort players</span>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'reports')}>
                <option value="newest">Newest first</option>
                <option value="reports">Most reports</option>
              </select>
            </label>
            <label className="sm:w-72">
              <span className="sr-only">Search players</span>
              <input
                type="search"
                className="input"
                placeholder="Search e-mail, Discord, character"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
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
                  isAdmin={isAdmin}
                  onChange={(next) => {
                    players.setData((all) => all?.map((p) => (p.id === next.id ? next : p)) ?? all);
                    history.reload();
                  }}
                  onDeleted={() => {
                    players.setData((all) => all?.filter((p) => p.id !== player.id) ?? all);
                    history.reload();
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {isAdmin && <AlertChannelsSection onChange={history.reload} />}

      {history.data && <AdminHistory actions={history.data} />}
    </>
  );
}

const ACTION_LABELS: Record<AdminActionEntry['action'], string> = {
  block: 'blocked',
  unblock: 'unblocked',
  unlink_discord: 'unlinked Discord of',
  delete: 'deleted the account of',
  add_character: 'added a character to',
  delete_character: 'deleted a character of',
  reset_password: 'reset the password of',
  grant_moderator: 'granted the moderator rank to',
  revoke_moderator: 'removed the moderator rank of',
  delete_report: 'deleted a report of',
  set_alert_channel: 'chose an alert channel on',
  reset_alert_channel: 'went back to the named alert channel on',
};

const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Who did what to which account, newest first (the last 50). */
function AdminHistory({ actions }: { actions: AdminActionEntry[] }) {
  return (
    <section className="mt-10" aria-labelledby="admin-history">
      <h2 id="admin-history" className="mb-4">
        Admin history
      </h2>
      {actions.length === 0 ? (
        <p className="border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">No admin actions yet.</p>
      ) : (
        <ol className="panel divide-y-2 divide-rule">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
              <time dateTime={a.created_at} className="w-32 shrink-0 text-muted tabular-nums">
                {timeFormat.format(new Date(a.created_at))}
              </time>
              <span className="min-w-0">
                <strong>{a.admin}</strong> {ACTION_LABELS[a.action] ?? a.action} <strong>{a.player}</strong>
                {a.details && <span className="text-muted">: {a.details}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function nameOf(player: Player): string {
  return player.email ?? player.discord_username ?? `account #${player.id}`;
}

type RowProps = {
  player: Player;
  /** The viewer is an admin (otherwise a moderator). */
  isAdmin: boolean;
  onChange: (player: Player) => void;
  onDeleted: () => void;
};

function PlayerRow({ player, isAdmin, onChange, onDeleted }: RowProps) {
  const [open, setOpen] = useState<'reports' | 'manage' | null>(null);
  const panelId = `${open ?? 'manage'}-${player.id}`;
  const toggle = (panel: 'reports' | 'manage') => setOpen((o) => (o === panel ? null : panel));

  return (
    <li className={`border-t-2 border-rule first:border-t-0 ${player.blocked ? 'bg-hp/5' : ''}`}>
      <div className="grid gap-x-4 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_8rem_9rem]">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 font-semibold" title={player.email ?? undefined}>
            <span className="truncate">{player.email ?? <span className="text-muted">No e-mail</span>}</span>
            {player.is_admin && <span className="shrink-0 border-2 border-accent px-1.5 text-xs text-accent-text">Admin</span>}
            {player.is_moderator && <span className="shrink-0 border-2 border-ink-2 px-1.5 text-xs text-ink-2">Moderator</span>}
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
          <div className="-ml-2 flex flex-wrap">
            {(['reports', 'manage'] as const).map((panel) => (
              <button
                key={panel}
                type="button"
                className="btn-quiet text-ink"
                aria-expanded={open === panel}
                aria-controls={open === panel ? panelId : undefined}
                onClick={() => toggle(panel)}
              >
                {panel === 'reports' ? 'Reports' : 'Manage'}
                <ChevronIcon className={`h-4 w-4 transition-transform duration-(--dur-micro) ${open === panel ? 'rotate-180' : ''}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
      {open === 'reports' && <ReportsPanel id={panelId} player={player} onChange={onChange} />}
      {open === 'manage' && <ManagePanel id={panelId} player={player} isAdmin={isAdmin} onChange={onChange} onDeleted={onDeleted} />}
    </li>
  );
}

const STATUS_LABELS: Record<PlayerReports['recent'][number]['status'], string> = { ACTIVE: 'Active', KILLED: 'Killed', EXPIRED: 'Expired' };
const STATUS_CLASSES: Record<PlayerReports['recent'][number]['status'], string> = {
  ACTIVE: 'border-accent text-accent-text',
  KILLED: 'border-ink-2 text-ink-2',
  EXPIRED: 'border-rule text-muted',
};

/** How often and what this player has reported: totals, outcomes, worlds, monsters and the newest reports. */
function ReportsPanel({ id, player, onChange }: { id: string; player: Player; onChange: (player: Player) => void }) {
  const reports = useAsync(() => endpoints.admin.reports(player.id), [player.id]);
  const toast = useToast();
  const [deleting, setDeleting] = useState<string | null>(null);
  const name = nameOf(player);
  const data = reports.data;

  async function deleteReport(report: PlayerReports['recent'][number]) {
    const what = `${report.monster} on ${report.server_name} (${timeFormat.format(new Date(report.created_at))})`;
    if (!window.confirm(`Delete the report of ${what}? It leaves the stats and its alert is deleted on Discord. This cannot be undone.`)) return;
    setDeleting(report.id);
    try {
      const { user } = await endpoints.admin.deleteReport(report.id);
      toast(`Deleted the report of ${what}.`, 'success');
      if (user) onChange(user);
      reports.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section id={id} aria-label={`Reports of ${name}`} className="space-y-6 border-t-2 border-dashed border-rule bg-paper px-5 py-5">
      {reports.error && <p className="text-sm text-hp">{reports.error.message}</p>}
      {reports.loading && !data && <p className="text-sm text-muted">Loading reports…</p>}
      {data && data.total === 0 && <p className="text-sm text-muted">{name} has not reported any Warden yet.</p>}
      {data && data.total > 0 && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['All time', data.total],
              ['Last 7 days', data.last_7_days],
              ['Last 30 days', data.last_30_days],
              ['Killed', data.by_status.killed],
              ['Expired', data.by_status.expired],
              ['Active now', data.by_status.active],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="label">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {data.first_report_at && data.last_report_at && (
            <p className="text-sm text-muted">
              First report {formatDate(data.first_report_at)}, last {formatDate(data.last_report_at)}.
            </p>
          )}

          <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="space-y-2">
              <h3 className="label">Worlds</h3>
              <ul className="space-y-1 text-sm">
                {data.worlds.map((w) => (
                  <li key={w.server_name} className="flex justify-between gap-3 border-b-2 border-rule py-1">
                    <span>{w.server_name}</span>
                    <span className="tabular-nums">{w.reports}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="label">Most reported</h3>
              <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
                {data.monsters.map((m) => (
                  <li key={m.name} className="flex items-center gap-2 border-b-2 border-rule py-1">
                    <MonsterImage src={m.image_url} className="h-8 w-8" />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="tabular-nums">{m.reports}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="label">{data.total > data.recent.length ? `Newest ${data.recent.length} reports` : 'Reports'}</h3>
            <ol className="divide-y-2 divide-rule text-sm">
              {data.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <time dateTime={r.created_at} className="w-32 shrink-0 text-muted tabular-nums">
                    {timeFormat.format(new Date(r.created_at))}
                  </time>
                  <MonsterImage src={r.image_url} className="h-8 w-8" />
                  <span className="min-w-0 flex-1">
                    <strong>{r.monster}</strong> <span className="text-muted">{r.server_name}</span>
                    <span className="block truncate text-ink-2">
                      {r.location}
                      {r.city && <span className="text-muted"> ({r.city})</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 border-2 px-1.5 text-xs ${STATUS_CLASSES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  <button
                    type="button"
                    className="btn-quiet min-w-10 shrink-0 justify-center hover:text-hp"
                    aria-label={`Delete the report of ${r.monster} on ${r.server_name}`}
                    title="Delete this report"
                    disabled={deleting !== null}
                    onClick={() => deleteReport(r)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * What staff may change. Admins: characters of anyone; the account actions for players who
 * are not admins. Moderators: characters and block / unblock of players who are not staff.
 */
function ManagePanel({ id, player, isAdmin, onChange, onDeleted }: RowProps & { id: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
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

  async function resetPassword() {
    if (!window.confirm(`Reset the password of ${name}? They will be logged out everywhere.`)) return;
    setBusy(true);
    try {
      const { password, user } = await endpoints.admin.resetPassword(player.id);
      setNewPassword(password);
      onChange(user);
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

  if (!isAdmin && (player.is_admin || player.is_moderator)) {
    return (
      <div id={id} className="border-t-2 border-dashed border-rule bg-paper px-5 py-5 text-sm text-muted">
        Only admins can change admin and moderator accounts.
      </div>
    );
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
            {isAdmin &&
              (player.is_moderator ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Remove the moderator rank of ${name}?`) &&
                    run(() => endpoints.admin.revokeModerator(player.id), `${name} is no longer a moderator.`)
                  }
                >
                  Remove moderator
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || player.blocked}
                  title={player.blocked ? 'Unblock first' : undefined}
                  onClick={() =>
                    window.confirm(`Make ${name} a moderator? They get the Players tab: report stats, deleting reports, blocking players and managing characters.`) &&
                    run(() => endpoints.admin.grantModerator(player.id), `${name} is now a moderator.`)
                  }
                >
                  Make moderator
                </button>
              ))}
            {isAdmin && player.discord_linked && (
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
            {isAdmin && player.email && (
              <button type="button" className="btn" disabled={busy} onClick={resetPassword}>
                Reset password
              </button>
            )}
            {newPassword && (
              <div className="space-y-1.5 border-3 border-accent p-3 text-sm" role="status">
                <p>
                  New password for <strong>{name}</strong>. Pass it on privately; it is shown only once:
                </p>
                <code className="block bg-paper-2 px-3 py-2 font-mono text-base font-semibold select-all">{newPassword}</code>
                <p className="text-muted">They can change it in the Characters tab.</p>
              </div>
            )}
            {!isAdmin ? null : confirmDelete ? (
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
