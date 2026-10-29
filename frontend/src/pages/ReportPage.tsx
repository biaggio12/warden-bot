import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { Monster } from '../api/types';
import { ClockIcon, MapPinIcon } from '../components/Icons';
import MonsterCombobox from '../components/MonsterCombobox';
import { useToast } from '../components/Toast';
import { formatClock, formatRemaining } from '../lib/time';
import { useAsync } from '../lib/useAsync';

export const TTL_OPTIONS = [5, 7, 10, 15] as const;
const DEFAULT_TTL = 7;
const LOCATION_MIN = 5;
const LOCATION_MAX = 255;
const INFO_MAX = 500;

export default function ReportPage() {
  const toast = useToast();
  const characters = useAsync(endpoints.characters, []);
  const monsters = useAsync(endpoints.monsters, []);
  const cities = useAsync(endpoints.cities, []);

  // No world picker: reports go to the world where the player has the most characters
  // (ties: alphabetical). Other worlds can be reported with /report world:... on Discord.
  const server = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of characters.data ?? []) counts.set(c.server_name, (counts.get(c.server_name) ?? 0) + 1);
    return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0] ?? '';
  }, [characters.data]);

  const [monster, setMonster] = useState<Monster | null>(null);
  const [city, setCity] = useState('');
  const [location, setLocation] = useState('');
  const [info, setInfo] = useState('');
  const [ttl, setTtl] = useState<number>(DEFAULT_TTL);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const trimmedLocation = location.trim();
  const trimmedInfo = info.trim();
  const errors = {
    server_name: server ? null : 'Choose a world.',
    monster_id: monster ? null : 'Choose a monster from the list.',
    city: city ? null : 'Choose a city.',
    location_description:
      trimmedLocation.length < LOCATION_MIN
        ? `Describe the location (at least ${LOCATION_MIN} characters).`
        : trimmedLocation.length > LOCATION_MAX
          ? `At most ${LOCATION_MAX} characters.`
          : null,
    additional_info: trimmedInfo.length > INFO_MAX ? `At most ${INFO_MAX} characters.` : null,
  };
  const isValid = Object.values(errors).every((e) => e === null);
  const errorFor = (field: keyof typeof errors) => serverErrors[field] ?? (touched[field] ? errors[field] : null);

  const spawns = useAsync(() => (server ? endpoints.activeSpawns(server) : Promise.resolve([])), [server]);
  useEffect(() => {
    const interval = setInterval(spawns.reload, 30_000);
    return () => clearInterval(interval);
  }, [spawns.reload]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Block incomplete data before any HTTP request is made.
    if (!isValid || !monster) {
      setTouched({ server_name: true, monster_id: true, city: true, location_description: true, additional_info: true });
      return;
    }
    setSubmitting(true);
    setServerErrors({});
    try {
      const spawn = await endpoints.reportSpawn({
        monster_id: monster.id,
        server_name: server,
        city,
        location_description: trimmedLocation,
        additional_info: trimmedInfo || null,
        ttl_minutes: ttl,
      });
      toast(`Reported successfully. Disappears at: ${formatClock(spawn.expires_at)}`, 'success');
      setMonster(null);
      setLocation('');
      setInfo('');
      setTtl(DEFAULT_TTL);
      setTouched({});
      setFormKey((k) => k + 1);
      spawns.reload();
    } catch (err) {
      if (err instanceof ApiError && err.problem?.violations) setServerErrors(err.fieldErrors);
      else toast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (characters.data?.length === 0) {
    return (
      <EmptyState
        title="Add a character to report Wardens"
        text="The worlds in the form come from your characters."
        href="#characters"
        action="Go to characters"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Report a Warden</h1>
        <p className="mt-1 text-muted">Players who are missing this monster get a ping on Discord.</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <form key={formKey} onSubmit={onSubmit} noValidate className="card space-y-6 p-5 sm:p-6">
          <Field label="Monster" error={errorFor('monster_id')}>
            <div onBlur={() => setTouched((t) => ({ ...t, monster_id: true }))}>
              <MonsterCombobox
                monsters={monsters.data ?? []}
                value={monster}
                invalid={!!errorFor('monster_id')}
                onChange={(m) => {
                  setMonster(m);
                  setServerErrors(({ monster_id: _, ...rest }) => rest);
                }}
              />
            </div>
          </Field>

          <Field
            label="Location"
            error={errorFor('city') ?? errorFor('location_description')}
            hint={`${trimmedLocation.length}/${LOCATION_MAX}`}
          >
            <div className="grid gap-2 sm:grid-cols-[11rem_1fr]">
              <select
                className={`input ${errorFor('city') ? 'border-danger' : ''}`}
                aria-label="City"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setServerErrors(({ city: _, ...rest }) => rest);
                }}
                onBlur={() => setTouched((t) => ({ ...t, city: true }))}
              >
                <option value="">City…</option>
                {cities.data?.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                className={`input ${errorFor('location_description') ? 'border-danger' : ''}`}
                aria-label="Spot"
                placeholder="e.g. Dragon Lair -2, by the gate"
                value={location}
                maxLength={LOCATION_MAX}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setServerErrors(({ location_description: _, ...rest }) => rest);
                }}
                onBlur={() => setTouched((t) => ({ ...t, location_description: true }))}
              />
            </div>
          </Field>

          <Field label="Additional info (optional)" error={errorFor('additional_info')} hint={`${trimmedInfo.length}/${INFO_MAX}`}>
            <textarea
              className={`input min-h-24 resize-y ${errorFor('additional_info') ? 'border-danger' : ''}`}
              aria-label="Additional info"
              placeholder="e.g. who is already waiting, the fastest way there, what to watch out for"
              rows={3}
              value={info}
              maxLength={INFO_MAX}
              onChange={(e) => {
                setInfo(e.target.value);
                setServerErrors(({ additional_info: _, ...rest }) => rest);
              }}
              onBlur={() => setTouched((t) => ({ ...t, additional_info: true }))}
            />
          </Field>

          <fieldset>
            <legend className="label mb-2">Time until it disappears</legend>
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup">
              {TTL_OPTIONS.map((minutes) => (
                <label
                  key={minutes}
                  className={`cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-semibold transition has-focus-visible:ring-2 has-focus-visible:ring-accent/40 ${
                    ttl === minutes ? 'bg-surface text-accent-strong shadow-sm' : 'text-muted hover:text-fg'
                  }`}
                >
                  <input type="radio" name="ttl" className="sr-only" checked={ttl === minutes} onChange={() => setTtl(minutes)} />
                  {minutes} min
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="btn-primary w-full py-3 text-base" disabled={!isValid || submitting}>
            {submitting ? 'Sending…' : 'Report'}
          </button>
        </form>

        <ActiveSpawns server={server} spawns={spawns.data ?? []} />
      </div>
    </div>
  );
}

export function EmptyState({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="card mx-auto max-w-md p-10 text-center">
      <p className="font-display text-xl font-bold">{title}</p>
      <p className="mt-2 mb-6 text-sm text-muted">{text}</p>
      <a href={href} className="btn-primary">
        {action}
      </a>
    </div>
  );
}

function Field({ label, error, hint, children }: { label: string; error: string | null; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        {hint && <span className="text-xs text-subtle tabular-nums">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

function ActiveSpawns({ server, spawns }: { server: string; spawns: Awaited<ReturnType<typeof endpoints.activeSpawns>> }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const visible = spawns.filter((s) => new Date(s.expires_at).getTime() > now);

  return (
    <aside className="card p-5 lg:sticky lg:top-24">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Active reports</h2>
        <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-muted">{server || '—'}</span>
      </div>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No active reports.</div>
      ) : (
        <ul className="space-y-3">
          {visible.map((spawn) => {
            const start = new Date(spawn.created_at).getTime();
            const end = new Date(spawn.expires_at).getTime();
            const left = Math.max(0, Math.min(1, (end - now) / (end - start)));
            return (
              <li key={spawn.id} className="rounded-xl border border-line bg-raised/50 p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{spawn.monster.name}</span>
                  <span className={`flex items-center gap-1 font-mono text-sm tabular-nums ${left < 0.25 ? 'text-danger' : 'text-accent-strong'}`}>
                    <ClockIcon className="h-3.5 w-3.5" />
                    {formatRemaining(spawn.expires_at, now)}
                  </span>
                </div>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
                  <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {spawn.city && <span className="font-medium text-fg">{spawn.city} — </span>}
                    {spawn.location_description}
                  </span>
                </p>
                {spawn.additional_info && (
                  <p className="mt-2 border-l-2 border-accent/50 pl-2.5 text-xs whitespace-pre-line text-muted">{spawn.additional_info}</p>
                )}
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${left < 0.25 ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${left * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
