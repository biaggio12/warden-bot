import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { Monster, WardenSpawn } from '../api/types';
import DiscordLinkSteps from '../components/DiscordLinkSteps';
import { EmptyState, PageHead } from '../components/PageHead';
import MonsterCombobox from '../components/MonsterCombobox';
import MonsterImage from '../components/MonsterImage';
import SegmentBar from '../components/SegmentBar';
import { useToast } from '../components/Toast';
import { formatClock, formatRemaining } from '../lib/time';
import { useAsync } from '../lib/useAsync';

/** A Warden disappears on its own 10 minutes after it shows up. */
export const TTL_OPTIONS = [2, 4, 6, 8, 10] as const;
const DEFAULT_TTL = 8;
const LOCATION_MIN = 5;
const LOCATION_MAX = 255;
const INFO_MAX = 500;

export default function ReportPage() {
  const toast = useToast();
  const characters = useAsync(endpoints.characters, []);
  const me = useAsync(endpoints.me, []);
  const monsters = useAsync(endpoints.monsters, []);
  const cities = useAsync(endpoints.cities, []);

  // No world picker: reports go to the world where the player has the most characters
  // (ties: alphabetical). Other worlds are reported with /warden in that world's Discord channel.
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

  // Where the alert goes: every Discord server the player is in, or just one of them.
  const guilds = useAsync(() => (server ? endpoints.discordGuilds(server).catch(() => []) : Promise.resolve([])), [server]);
  const [guildId, setGuildId] = useState('');
  const chosenGuild = guilds.data?.some((g) => g.id === guildId) ? guildId : '';

  const spawns = useAsync(() => (server ? endpoints.activeSpawns(server) : Promise.resolve([])), [server]);
  useEffect(() => {
    const interval = setInterval(spawns.reload, 30_000);
    return () => clearInterval(interval);
  }, [spawns.reload]);

  // Two players reporting the same Warden ping everyone twice; it is not blocked (there can
  // be two of a kind on a world), but the second one is asked first.
  const [duplicateOf, setDuplicateOf] = useState<WardenSpawn | null>(null);

  async function onSubmit(event: FormEvent | null, confirmed = false) {
    event?.preventDefault();
    // Block incomplete data before any HTTP request is made.
    if (!isValid || !monster) {
      setTouched({ server_name: true, monster_id: true, city: true, location_description: true, additional_info: true });
      return;
    }
    const duplicate = (spawns.data ?? []).find((s) => s.monster.id === monster.id && new Date(s.expires_at).getTime() > Date.now());
    if (duplicate && !confirmed) {
      setDuplicateOf(duplicate);
      return;
    }
    setDuplicateOf(null);
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
        discord_guild_id: chosenGuild || null,
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
        text="Reports go to the world your characters play on."
        href="#characters"
        action="Go to characters"
      />
    );
  }

  // The backend refuses reports from accounts without Discord: the bot could not tell which servers are theirs.
  if (me.data && !me.data.discord_linked) {
    return (
      <div className="panel max-w-xl">
        <div className="border-b-3 border-outline bg-discord px-6 py-5 text-discord-ink">
          <h1>Link Discord to report Wardens</h1>
        </div>
        <div className="space-y-5 p-6">
          <p className="text-muted">
            Alerts go to the Discord servers you are on, so the bot needs to know your Discord account. Linking also gets you pinged about Wardens
            your characters are missing.
          </p>
          <DiscordLinkSteps onCheck={me.reload} />
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="Report a Warden" lead="Players who are missing this monster get a ping on Discord." />

      <div className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <form key={formKey} onSubmit={onSubmit} noValidate className="panel space-y-6 p-5 sm:p-7">
          <Field label="Monster" error={errorFor('monster_id')}>
            <div onBlur={() => setTouched((t) => ({ ...t, monster_id: true }))}>
              <MonsterCombobox
                monsters={monsters.data ?? []}
                value={monster}
                invalid={!!errorFor('monster_id')}
                onChange={(m) => {
                  setMonster(m);
                  setDuplicateOf(null);
                  setServerErrors(({ monster_id: _, ...rest }) => rest);
                }}
              />
            </div>
          </Field>

          <Field label="Location" error={errorFor('city') ?? errorFor('location_description')} hint={`${trimmedLocation.length}/${LOCATION_MAX}`}>
            <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <select
                className={`input ${errorFor('city') ? 'border-hp' : ''}`}
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
                className={`input ${errorFor('location_description') ? 'border-hp' : ''}`}
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
              className={`input min-h-24 resize-y ${errorFor('additional_info') ? 'border-hp' : ''}`}
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
            <div className="cells max-w-md" role="radiogroup">
              {TTL_OPTIONS.map((minutes) => (
                <label key={minutes} className={`cell ${ttl === minutes ? 'cell-on' : ''}`}>
                  <input type="radio" name="ttl" className="sr-only" checked={ttl === minutes} onChange={() => setTtl(minutes)} />
                  {minutes} min
                </label>
              ))}
            </div>
          </fieldset>

          {(guilds.data?.length ?? 0) > 1 && (
            <Field label="Send to Discord" error={serverErrors.discord_guild_id ?? null}>
              <select
                className={`input max-w-md ${serverErrors.discord_guild_id ? 'border-hp' : ''}`}
                aria-label="Discord server"
                value={chosenGuild}
                onChange={(e) => {
                  setGuildId(e.target.value);
                  setServerErrors(({ discord_guild_id: _, ...rest }) => rest);
                }}
              >
                <option value="">All my servers ({guilds.data!.length})</option>
                {guilds.data!.map((g) => (
                  <option key={g.id} value={g.id}>
                    Only {g.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {duplicateOf ? (
            <div className="space-y-3 border-3 border-accent p-4" role="alert">
              <p>
                <strong>{duplicateOf.monster.name}</strong> is already reported on {duplicateOf.server_name}
                {duplicateOf.city || duplicateOf.location_description ? ': ' : ''}
                {[duplicateOf.city, duplicateOf.location_description].filter(Boolean).join(', ')}
                {' '}({formatRemaining(duplicateOf.expires_at, Date.now())} left, by {reporterName(duplicateOf)}). Players were pinged already.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-quiet" onClick={() => setDuplicateOf(null)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" disabled={submitting} onClick={() => onSubmit(null, true)}>
                  It is another one, report it
                </button>
              </div>
            </div>
          ) : (
            <button type="submit" className="btn-primary min-h-12 px-10 text-base" disabled={!isValid || submitting}>
              {submitting ? 'Sending…' : 'Report'}
            </button>
          )}
        </form>

        <ActiveSpawns
          server={server}
          spawns={spawns.data ?? []}
          onClosed={(id) => spawns.setData((list) => list?.filter((s) => s.id !== id) ?? list)}
        />
      </div>
    </>
  );
}

/** The reporter's characters on that world (they call the attack in game), else their Discord name. */
function reporterName(spawn: WardenSpawn): string {
  const by = spawn.reported_by;
  if (by?.characters.length) return by.discord_name ? `${by.characters.join(', ')} (${by.discord_name})` : by.characters.join(', ');
  return by?.discord_name ?? 'a player';
}

function Field({ label, error, hint, children }: { label: string; error: string | null; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="label">{label}</span>
        {hint && <span className="text-xs text-subtle tabular-nums">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-sm font-medium text-hp">{error}</p>}
    </div>
  );
}

/** Which of the viewer's characters on that world still need this Warden. */
function YourCharacters({ spawn }: { spawn: WardenSpawn }) {
  const mine = spawn.your_characters;
  if (!mine || mine.missing.length + mine.done.length === 0) return null;
  if (mine.missing.length === 0) {
    return <p className="mt-1 text-sm text-muted">All your characters have it already.</p>;
  }
  return (
    <p className="mt-1 text-sm text-muted">
      Missing on <span className="font-semibold text-xp">{mine.missing.join(', ')}</span>
      {mine.done.length > 0 && <> · has it: {mine.done.join(', ')}</>}
    </p>
  );
}

type ActiveSpawnsProps = {
  server: string;
  spawns: Awaited<ReturnType<typeof endpoints.activeSpawns>>;
  onClosed: (id: string) => void;
};

function ActiveSpawns({ server, spawns, onClosed }: ActiveSpawnsProps) {
  const toast = useToast();
  const [now, setNow] = useState(Date.now);
  // Closing a report takes the alert down for everyone, so it takes a second click.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const visible = spawns.filter((s) => new Date(s.expires_at).getTime() > now);

  async function close(id: string, name: string) {
    setClosing(id);
    try {
      await endpoints.killSpawn(id);
      onClosed(id);
      toast(`${name} marked as dead. Players on the way were told on Discord.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setClosing(null);
      setConfirming(null);
    }
  }

  return (
    <aside className="lg:sticky lg:top-24">
      <h2 className="mb-4">
        Active on <span>{server || 'your world'}</span>
      </h2>
      {visible.length === 0 ? (
        <p className="border-3 border-dashed border-rule px-4 py-6 text-sm text-muted">No active reports.</p>
      ) : (
        <ul className="space-y-4">
          {visible.map((spawn) => {
            const start = new Date(spawn.created_at).getTime();
            const end = new Date(spawn.expires_at).getTime();
            const left = Math.max(0, Math.min(1, (end - now) / (end - start)));
            const late = left < 0.25;
            return (
              <li key={spawn.id} className="panel p-4">
                <div className="flex gap-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-outline bg-paper">
                    <MonsterImage src={spawn.monster.image_url ?? null} className="h-12 w-12" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-lg font-semibold">{spawn.monster.name}</p>
                      <span className={`text-lg font-bold tabular-nums ${late ? 'text-hp' : 'text-ink'}`}>{formatRemaining(spawn.expires_at, now)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      {spawn.city ? `${spawn.city}, ` : ''}
                      {spawn.location_description}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Reported by <span className="font-semibold text-ink">{reporterName(spawn)}</span>
                    </p>
                    <YourCharacters spawn={spawn} />
                  </div>
                </div>
                <SegmentBar value={left} kind="hp" className="mt-3" />
                {spawn.additional_info && <p className="mt-3 border-t-2 border-rule pt-2 text-sm whitespace-pre-line text-ink-2">{spawn.additional_info}</p>}
                {/* Only the reporter closes it: they are at the Warden and call the attack. */}
                {spawn.is_yours && (
                  <div className="mt-3 flex items-center justify-end gap-2">
                    {confirming === spawn.id ? (
                      <>
                        <span className="mr-auto text-sm text-muted">Killed already?</span>
                        <button type="button" className="btn-quiet" onClick={() => setConfirming(null)} disabled={closing === spawn.id}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn bg-hp text-hp-ink hover:bg-hp"
                          onClick={() => close(spawn.id, spawn.monster.name)}
                          disabled={closing === spawn.id}
                        >
                          {closing === spawn.id ? 'Closing…' : 'Yes, remove it'}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-quiet" onClick={() => setConfirming(spawn.id)}>
                        Gone? Remove report
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
