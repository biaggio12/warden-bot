import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { AdminDuel, DuelPair, DuelReport } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { ChevronIcon } from './Icons';

const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const formatTime = (iso: string) => timeFormat.format(new Date(iso));

const FLAG_LABELS: Record<DuelPair['flags'][number], string> = {
  repeated: '3+ duels in 7 days',
  one_sided: 'one side wins every staked duel',
};

const STATUS_LABELS: Record<AdminDuel['status'], string> = {
  pending: 'Waiting',
  active: 'Running',
  finished: 'Finished',
  declined: 'Declined',
  expired: 'Not answered',
};

/**
 * Staff: who challenged whom, which pairs keep meeting (and who wins the points), and for each
 * duel the reports that scored and who confirmed them, to spot points being farmed.
 */
/** yyyy-mm-dd of a local date, as <input type="date"> wants it. */
function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a yyyy-mm-dd day, plus `days`, as an ISO date-time for the API. */
function midnight(day: string, days = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d! + days).toISOString();
}

export default function DuelReviewSection({ players = [] }: { players?: { id: number; name: string }[] }) {
  const today = dayString(new Date());
  const [from, setFrom] = useState(() => dayString(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState<number | null>(null);
  const valid = from !== '' && to !== '' && from <= to;
  const data = useAsync(
    // Both days count in full: until is the midnight after `to`.
    () => (valid ? endpoints.admin.duels({ from: midnight(from), until: midnight(to, 1), userId: userId ?? undefined }) : Promise.resolve(null)),
    [from, to, userId, valid],
  );
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="mt-10 space-y-6" aria-labelledby="duel-review">
      <div>
        <h2 id="duel-review">Duels</h2>
        <p className="mt-1 text-sm text-muted">
          Who challenged whom, in the dates you pick (both days included). Pairs that keep meeting, or where one side always wins the
          stake, are flagged; open a duel to see which reports scored and who confirmed them.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" aria-label="Filter duels" onSubmit={(e) => e.preventDefault()}>
        <label className="text-sm">
          <span className="mb-1 block text-muted">From</span>
          <input type="date" className="input" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">To</span>
          <input type="date" className="input" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-sm sm:w-64">
          <span className="mb-1 block text-muted">Player</span>
          <select className="input" value={userId ?? ''} onChange={(e) => setUserId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Everyone</option>
            {sortedPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </form>

      {!valid && <p className="text-sm text-hp">Pick a start date on or before the end date.</p>}
      {data.error && <p className="panel p-4 text-hp">{data.error.message}</p>}
      {data.loading && !data.data && <p className="text-muted">Loading duels…</p>}

      {valid && data.data && (
        <div className={`space-y-6 transition-opacity duration-(--dur-short) ${data.loading ? 'opacity-60' : ''}`}>
          <Pairs pairs={data.data.pairs} />
          <DuelList duels={data.data.duels} />
          {data.data.truncated && <p className="text-sm text-muted">Showing the newest {data.data.duels.length}; pick a shorter window to see the rest.</p>}
        </div>
      )}
    </section>
  );
}

function Pairs({ pairs }: { pairs: DuelPair[] }) {
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">Pairs</h3>
      {pairs.length === 0 ? (
        <p className="border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">No duel finished in these dates.</p>
      ) : (
        <ul className="panel divide-y-2 divide-rule" aria-label="Duel pairs">
          {pairs.map((pair) => (
            <li key={`${pair.a.id}-${pair.b.id}`} className={`px-5 py-3 text-sm ${pair.flags.length ? 'bg-hp/5' : ''}`}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong>{pair.a.name}</strong>
                <span className="tabular-nums">
                  {pair.a_wins} : {pair.b_wins}
                  {pair.draws > 0 && <span className="text-muted"> ({pair.draws} drawn)</span>}
                </span>
                <strong>{pair.b.name}</strong>
                {pair.flags.map((flag) => (
                  <span key={flag} className="border-2 border-hp px-1.5 text-xs text-hp">
                    {FLAG_LABELS[flag]}
                  </span>
                ))}
              </p>
              <p className="text-muted tabular-nums">
                {pair.duels} duel{pair.duels === 1 ? '' : 's'}
                {pair.stakes_to_a !== 0 &&
                  `, ${Math.abs(pair.stakes_to_a)} point(s) went to ${pair.stakes_to_a > 0 ? pair.a.name : pair.b.name}`}
                , last {formatTime(pair.last_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DuelList({ duels }: { duels: AdminDuel[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">Duels, newest first</h3>
      {duels.length === 0 ? (
        <p className="border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">Nobody challenged anyone in these dates.</p>
      ) : (
        <ol className="panel divide-y-2 divide-rule" aria-label="Latest duels">
          {duels.map((duel) => {
            const expanded = open === duel.id;
            const started = duel.starts_at !== null;
            return (
              <li key={duel.id} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5">
                  <time dateTime={duel.created_at} className="w-32 shrink-0 text-muted tabular-nums">
                    {formatTime(duel.created_at)}
                  </time>
                  <span className="min-w-0 flex-1">
                    <strong>{duel.challenger.name}</strong> challenged <strong>{duel.opponent.name}</strong>
                    <span className="text-muted">
                      {' '}
                      · {duel.minutes} min · {duel.stake > 0 ? `${duel.stake} point(s) at stake` : 'no stake'} · {STATUS_LABELS[duel.status]}
                    </span>
                    {duel.challenger.score !== null && (
                      <span className="tabular-nums">
                        {' '}
                        · {duel.challenger.score} : {duel.opponent.score}
                        {duel.result && duel.result !== 'draw' && ` (${duel[duel.result].name} won)`}
                        {duel.result === 'draw' && ' (draw)'}
                      </span>
                    )}
                  </span>
                  {started && (
                    <button
                      type="button"
                      className="btn-quiet text-ink"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : duel.id)}
                    >
                      Reports
                      <ChevronIcon className={`h-4 w-4 transition-transform duration-(--dur-micro) ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                {expanded && <DuelReports duelId={duel.id} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function confirmationText(c: DuelReport['confirmations'][number]): string {
  if (c.type === 'dead') return c.name ? `Dead by ${c.name}` : 'Dead clicked';
  return c.type === 'omw' ? `OMW by ${c.name}` : `killed by ${c.name}`;
}

/** Every report the two players made during the duel: whether it scored and who confirmed it. */
function DuelReports({ duelId }: { duelId: string }) {
  const details = useAsync(() => endpoints.admin.duelDetails(duelId), [duelId]);

  if (details.error) return <p className="px-5 pb-3 text-hp">{details.error.message}</p>;
  if (!details.data) return <p className="px-5 pb-3 text-muted">Loading reports…</p>;
  if (details.data.reports.length === 0) {
    return <p className="border-t-2 border-dashed border-rule px-5 py-3 text-muted">Neither player reported a Warden during this duel.</p>;
  }

  return (
    <ul className="border-t-2 border-dashed border-rule bg-paper px-5 py-3" aria-label="Reports during the duel">
      {details.data.reports.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
          <time dateTime={r.created_at} className="w-32 shrink-0 text-muted tabular-nums">
            {formatTime(r.created_at)}
          </time>
          <span className="min-w-0 flex-1">
            <strong>{r.reporter.name}</strong>: {r.monster} on {r.server_name}
            <span className="text-muted">
              {' '}
              · {r.confirmations.length > 0 ? r.confirmations.map(confirmationText).join(', ') : 'not confirmed'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {r.confirmed_only_by_duel_players && <span className="border-2 border-hp px-1.5 text-xs text-hp">only the duel's players confirmed</span>}
            {r.duplicate && <span className="border-2 border-rule px-1.5 text-xs text-muted">duplicate</span>}
            <span className={`tabular-nums ${r.counted ? 'font-semibold' : 'text-muted'}`}>{r.counted ? `+${r.points}` : '0'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
