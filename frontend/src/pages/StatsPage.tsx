import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { CountRow, Stats, StatsPeriod } from '../api/types';
import { TrophyIcon } from '../components/Icons';
import { PageHead } from '../components/PageHead';
import SegmentBar from '../components/SegmentBar';
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
    <>
      <PageHead
        title="Stats"
        lead="Who reports the most Wardens, and what turns up where."
        aside={
          <div role="radiogroup" aria-label="Period" className="cells">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={period === p.value}
                onClick={() => setPeriod(p.value)}
                className={`cell px-4 ${period === p.value ? 'cell-on' : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {stats.error && !data && <p className="panel p-4 text-hp">{stats.error.message}</p>}

      {data && (
        <div className={`space-y-8 transition-opacity duration-(--dur-short) ${stats.loading ? 'opacity-60' : ''}`}>
          <dl className="panel grid grid-cols-2 lg:grid-cols-4">
            <StatTile label="Reports" value={data.totals.reports} />
            <StatTile label="Active now" value={data.totals.active_now} />
            <StatTile label="Reporters" value={data.totals.reporters} />
            <StatTile
              label="Your rank"
              value={data.you.rank ? `#${data.you.rank}` : 'None'}
              note={data.you.rank ? `of ${data.you.reporters}` : 'no reports yet'}
            />
          </dl>

          <DailyChart days={data.reports_per_day} period={period} />

          <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <Leaderboard rows={data.leaderboard} />
            <YourStats you={data.you} periodLabel={PERIODS.find((p) => p.value === period)!.label.toLowerCase()} />
          </div>

          <BestiaryLeaders rows={data.bestiary_leaderboard ?? []} />

          <div className="grid gap-8 md:grid-cols-2">
            <TopList title="Most reported monsters" rows={data.top_monsters} />
            <TopList title="Top cities" rows={data.top_cities} />
          </div>
        </div>
      )}
    </>
  );
}

function StatTile({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="border-outline p-4 sm:p-5 nth-[n+2]:border-l-3 max-lg:nth-3:border-l-0 max-lg:nth-[n+3]:border-t-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-2 text-4xl leading-none font-bold tabular-nums">{value}</dd>
      {note && <dd className="mt-1.5 text-sm text-muted">{note}</dd>}
    </div>
  );
}

/** One series (reports per day): single hue, no legend; hover shows the exact value. */
function DailyChart({ days, period }: { days: Stats['reports_per_day']; period: StatsPeriod }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const active = hovered === null ? null : days[hovered];
  const title = period === 'all' ? 'Reports per day, last 90 days' : 'Reports per day';

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2>{title}</h2>
        <p className="text-sm text-muted tabular-nums" aria-live="polite">
          {active ? (
            <>
              <span className="font-semibold text-ink">{plural(active.count, 'report')}</span> on {formatDay(active.date)}
            </>
          ) : (
            plural(total, 'report')
          )}
        </p>
      </div>

      <div className="relative mt-8 h-44" onMouseLeave={() => setHovered(null)} aria-hidden="true">
        <div className="absolute inset-x-0 top-0 border-t-2 border-dashed border-rule" />
        <span className="absolute -top-6 left-0 text-sm text-muted tabular-nums">{max}</span>
        <div className="absolute inset-x-0 bottom-0 border-t-3 border-outline" />
        <div className="relative flex h-full items-end gap-[2px]">
          {days.map((day, i) => (
            <div key={day.date} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHovered(i)}>
              <div
                className={`w-full bg-chart transition-opacity duration-(--dur-micro) ${hovered !== null && hovered !== i ? 'opacity-40' : ''}`}
                style={{ height: day.count ? `${Math.max(2, (day.count / max) * 100)}%` : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted tabular-nums" aria-hidden="true">
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

const MEDALS = ['bg-medal-1', 'bg-medal-2', 'bg-medal-3'];

function Leaderboard({ rows }: { rows: Stats['leaderboard'] }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="flex items-center gap-2">
        <TrophyIcon className="h-5 w-5 text-accent-text" />
        Top reporters
      </h2>
      {rows.length === 0 ? (
        <Empty text="No reports in this period yet." />
      ) : (
        <ol className="mt-4 space-y-2">
          {rows.map((row) => (
            <li
              key={`${row.rank}-${row.player}`}
              className={`flex items-center gap-3 border-2 px-3 py-2 ${row.is_you ? 'border-accent bg-accent-soft' : 'border-rule bg-paper-3'}`}
            >
              <RankBadge rank={row.rank} />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {row.player}
                {row.is_you && <span className="ml-2 text-sm font-semibold text-accent-text">you</span>}
              </span>
              <span className="text-xl font-bold tabular-nums">
                {row.reports} <span className="sr-only">{row.reports === 1 ? 'report' : 'reports'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center text-lg font-bold tabular-nums ${
        MEDALS[rank - 1] ? `${MEDALS[rank - 1]} text-accent-ink outline-2 outline-outline` : 'text-muted'
      }`}
    >
      {rank}
    </span>
  );
}

/** Characters ranked by how much of the bestiary they have marked; the bar fills like XP. */
function BestiaryLeaders({ rows }: { rows: Stats['bestiary_leaderboard'] }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2>Bestiary leaders</h2>
        <p className="text-sm text-muted">All time, by character</p>
      </div>
      {rows.length === 0 ? (
        <Empty text="No character has marked a monster yet." />
      ) : (
        <ol className="mt-4 grid gap-2 lg:grid-cols-2 lg:gap-x-4">
          {rows.map((row) => (
            <li
              key={`${row.rank}-${row.character}-${row.server_name}`}
              className={`flex items-center gap-3 border-2 px-3 py-2 ${row.is_you ? 'border-accent bg-accent-soft' : 'border-rule bg-paper-3'}`}
            >
              <RankBadge rank={row.rank} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">
                    {row.character} <span className="font-normal text-muted">({row.server_name})</span>
                    {row.is_you && <span className="ml-2 text-sm font-semibold text-accent-text">you</span>}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {row.killed}
                    <span className="font-normal text-muted">/{row.total}</span>
                  </span>
                </div>
                <SegmentBar value={row.total ? row.killed / row.total : 0} kind="xp" className="mt-1.5" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function YourStats({ you, periodLabel }: { you: Stats['you']; periodLabel: string }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h2>Your stats</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-muted">Reports, {periodLabel}</dt>
          <dd className="mt-1 text-3xl leading-none font-bold tabular-nums">{you.reports}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Reports, all time</dt>
          <dd className="mt-1 text-3xl leading-none font-bold tabular-nums">{you.reports_all_time}</dd>
        </div>
      </dl>
      <h3 className="mt-6 mb-3">Bestiary progress</h3>
      {you.characters.length === 0 ? (
        <Empty text="Add a character to track its bestiary." />
      ) : (
        <ul className="space-y-3">
          {you.characters.map((c) => {
            const share = c.total ? c.killed / c.total : 0;
            return (
              <li key={`${c.name}-${c.server_name}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-semibold">
                    {c.name} <span className="font-normal text-muted">({c.server_name})</span>
                  </span>
                  <span className="text-muted tabular-nums">
                    {c.killed}/{c.total}, {Math.round(share * 100)}%
                  </span>
                </div>
                <SegmentBar value={share} kind="xp" className="mt-1.5" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Ranked rows with the value as text; the bar under each is a visual aid only. */
function TopList({ title, rows }: { title: string; rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel p-5 sm:p-6">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <Empty text="Nothing yet." />
      ) : (
        <ol className="mt-4 space-y-2.5">
          {rows.map((row) => (
            <li key={row.label} title={`${row.label}: ${plural(row.count, 'report')}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="font-bold tabular-nums">{row.count}</span>
              </div>
              <div className="mt-1 h-2.5 border-2 border-outline bg-paper-3" aria-hidden="true">
                <div className="h-full origin-left bg-chart" style={{ transform: `scaleX(${row.count / max})` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-4 border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">{text}</p>;
}
