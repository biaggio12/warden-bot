import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { CountRow, Stats, StatsPeriod } from '../api/types';
import { TrophyIcon } from '../components/Icons';
import { useAsync } from '../lib/useAsync';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];

const PERIOD_KEY = 'warden-tracker.stats-period';

function readPeriod(): StatsPeriod {
  try {
    const saved = localStorage.getItem(PERIOD_KEY);
    return saved === '7d' || saved === 'all' ? saved : '30d';
  } catch {
    return '30d';
  }
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function StatsPage() {
  const [period, setPeriodState] = useState<StatsPeriod>(readPeriod);
  const stats = useAsync(() => endpoints.stats(period), [period]);
  const data = stats.data;

  function setPeriod(next: StatsPeriod) {
    try {
      localStorage.setItem(PERIOD_KEY, next);
    } catch {
      // per-view only
    }
    setPeriodState(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Stats</h1>
          <p className="mt-1 text-muted">Who reports the most Wardens, and what turns up where.</p>
        </div>
        <div role="radiogroup" aria-label="Period" className="flex rounded-xl border border-line bg-raised p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                period === p.value ? 'bg-surface text-accent-strong shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {stats.error && !data && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{stats.error.message}</p>}

      {data && (
        <div className={`space-y-6 transition-opacity ${stats.loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Reports" value={data.totals.reports} />
            <StatTile label="Active now" value={data.totals.active_now} />
            <StatTile label="Reporters" value={data.totals.reporters} />
            <StatTile
              label="Your rank"
              value={data.you.rank ? `#${data.you.rank}` : '—'}
              note={data.you.rank ? `of ${data.you.reporters}` : 'no reports yet'}
            />
          </div>

          <DailyChart days={data.reports_per_day} period={period} />

          <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
            <Leaderboard rows={data.leaderboard} />
            <YourStats you={data.you} periodLabel={PERIODS.find((p) => p.value === period)!.label.toLowerCase()} />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <TopList title="Most reported monsters" rows={data.top_monsters} />
            <TopList title="Top cities" rows={data.top_cities} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-subtle">{note}</p>}
    </div>
  );
}

/** One series (reports per day): single hue, no legend; hover shows the exact value. */
function DailyChart({ days, period }: { days: Stats['reports_per_day']; period: StatsPeriod }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const active = hovered === null ? null : days[hovered];
  const title = period === 'all' ? 'Reports per day · last 90 days' : 'Reports per day';

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted tabular-nums" aria-live="polite">
          {active ? (
            <>
              <span className="font-semibold text-fg">{plural(active.count, 'report')}</span> on {formatDay(active.date)}
            </>
          ) : (
            plural(total, 'report')
          )}
        </p>
      </div>

      <div className="relative mt-7 h-44" onMouseLeave={() => setHovered(null)} aria-hidden="true">
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <span className="absolute -top-5 left-0 text-[11px] text-subtle tabular-nums">{max}</span>
        <div className="absolute inset-x-0 bottom-0 border-t border-line" />
        <div className="relative flex h-full items-end gap-[2px]">
          {days.map((day, i) => (
            <div
              key={day.date}
              className="flex h-full flex-1 cursor-default items-end"
              onMouseEnter={() => setHovered(i)}
            >
              <div
                className={`w-full rounded-t-[4px] bg-chart transition-opacity ${hovered !== null && hovered !== i ? 'opacity-40' : ''}`}
                style={{ height: day.count ? `${Math.max(2, (day.count / max) * 100)}%` : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-subtle" aria-hidden="true">
        <span>{days[0] && formatDay(days[0].date)}</span>
        <span>{days.length > 2 && formatDay(days[Math.floor(days.length / 2)]!.date)}</span>
        <span>{days.at(-1) && formatDay(days.at(-1)!.date)}</span>
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Reports</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{formatDay(d.date)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const MEDALS = ['bg-[#e0b23c] text-[#3b2a05]', 'bg-[#b9bec7] text-[#23262c]', 'bg-[#c98a55] text-[#2e1a0b]'];

function Leaderboard({ rows }: { rows: Stats['leaderboard'] }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <TrophyIcon className="h-4 w-4 text-accent" />
        Top reporters
      </h2>
      {rows.length === 0 ? (
        <Empty text="No reports in this period yet." />
      ) : (
        <ol className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={`${row.rank}-${row.player}`}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${row.is_you ? 'bg-accent-soft ring-1 ring-accent/30' : 'bg-raised/50'}`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                  MEDALS[row.rank - 1] ?? 'bg-surface text-muted ring-1 ring-line'
                }`}
              >
                {row.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.player}
                {row.is_you && <span className="ml-2 text-xs font-semibold text-accent-strong">you</span>}
              </span>
              <span className="text-sm text-muted tabular-nums">
                <span className="font-semibold text-fg">{row.reports}</span> {row.reports === 1 ? 'report' : 'reports'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function YourStats({ you, periodLabel }: { you: Stats['you']; periodLabel: string }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 font-semibold">Your stats</h2>
      <dl className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-raised/60 p-3">
          <dt className="text-xs text-muted">Reports · {periodLabel}</dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums">{you.reports}</dd>
        </div>
        <div className="rounded-xl bg-raised/60 p-3">
          <dt className="text-xs text-muted">Reports · all time</dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums">{you.reports_all_time}</dd>
        </div>
      </dl>
      <h3 className="mb-2.5 text-sm font-medium text-muted">Bestiary progress</h3>
      {you.characters.length === 0 ? (
        <Empty text="Add a character to track its bestiary." />
      ) : (
        <ul className="space-y-3">
          {you.characters.map((c) => {
            const share = c.total ? c.killed / c.total : 0;
            return (
              <li key={`${c.name}-${c.server_name}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">
                    {c.name} <span className="text-xs font-normal text-subtle">{c.server_name}</span>
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {c.killed}/{c.total} · {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-chart" style={{ width: `${share * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Ranked bars with the value as text next to each (the bar length is a visual aid only). */
function TopList({ title, rows }: { title: string; rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <Empty text="Nothing yet." />
      ) : (
        <ol className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.label} title={`${row.label}: ${plural(row.count, 'report')}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="font-semibold tabular-nums">{row.count}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-line/60">
                <div className="h-full rounded-full bg-chart" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{text}</div>;
}
