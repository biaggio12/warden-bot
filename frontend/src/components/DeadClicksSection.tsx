import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { DeadClickPair } from '../api/types';
import { dayString, midnight } from '../lib/dates';
import { useAsync } from '../lib/useAsync';

const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const FLAG_LABELS: Record<DeadClickPair['flags'][number], string> = {
  frequent: '5+ closures',
  quick: 'mostly within 2 min',
  one_closer: 'closes most of their reports',
};

/**
 * Staff: who closes whose reports with [Dead]. A closure confirms the report and earns the
 * reporter points, so a player who keeps closing one reporter's Wardens, or closes them right
 * after they are made, may be helping them farm points.
 */
export default function DeadClicksSection({ players = [] }: { players?: { id: number; name: string }[] }) {
  const today = dayString(new Date());
  const [from, setFrom] = useState(() => dayString(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState<number | null>(null);
  const valid = from !== '' && to !== '' && from <= to;
  const data = useAsync(
    // Both days count in full: until is the midnight after `to`.
    () => (valid ? endpoints.admin.deadClicks({ from: midnight(from), until: midnight(to, 1), userId: userId ?? undefined }) : Promise.resolve(null)),
    [from, to, userId, valid],
  );
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">
          Who closed whose reports with Dead, in the dates you pick (both days included). A closure confirms the report and gives the reporter points; one
          player closing most of someone&apos;s reports, or closing them right away, is flagged.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" aria-label="Filter Dead clicks" onSubmit={(e) => e.preventDefault()}>
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
      {data.loading && !data.data && <p className="text-muted">Loading Dead clicks…</p>}

      {valid && data.data && (
        <div className={`transition-opacity duration-(--dur-short) ${data.loading ? 'opacity-60' : ''}`}>
          {data.data.pairs.length === 0 ? (
            <p className="border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">Nobody closed someone else&apos;s report in these dates.</p>
          ) : (
            <ul className="panel divide-y-2 divide-rule" aria-label="Dead click pairs">
              {data.data.pairs.map((pair) => (
                <li key={`${pair.closer.id}-${pair.reporter.id}`} className={`px-5 py-3 text-sm ${pair.flags.length ? 'bg-hp/5' : ''}`}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      <strong>{pair.closer.name}</strong> <span className="text-muted">closed reports of</span> <strong>{pair.reporter.name}</strong>{' '}
                      <span className="tabular-nums">× {pair.closures}</span>
                    </span>
                    {pair.flags.map((flag) => (
                      <span key={flag} className="border-2 border-hp px-1.5 text-xs text-hp">
                        {FLAG_LABELS[flag]}
                      </span>
                    ))}
                  </p>
                  <p className="text-muted tabular-nums">
                    {pair.quick} within 2 min · typically {pair.median_minutes} min after the report · {Math.round(pair.share * 100)}% of their reports closed
                    by others · last {timeFormat.format(new Date(pair.last_at))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
