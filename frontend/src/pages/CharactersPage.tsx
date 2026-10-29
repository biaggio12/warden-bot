import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import DiscordButton from '../components/DiscordButton';
import { CheckIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useAsync } from '../lib/useAsync';
import { formatClock } from '../lib/time';

export default function CharactersPage() {
  const toast = useToast();
  const characters = useAsync(endpoints.characters, []);
  const worlds = useAsync(endpoints.worlds, []);
  const me = useAsync(endpoints.me, []);
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [linkCode, setLinkCode] = useState<{ code: string; expires_at: string } | null>(null);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await endpoints.createCharacter(name.trim(), server);
      setName('');
      characters.reload();
      toast(`Added ${name.trim()}.`, 'success');
    } catch (err) {
      if (err instanceof ApiError && err.problem?.violations) setErrors(err.fieldErrors);
      else toast((err as Error).message, 'error');
    }
  }

  async function onDelete(id: string, characterName: string) {
    if (!window.confirm(`Delete ${characterName} together with their bestiary?`)) return;
    try {
      await endpoints.deleteCharacter(id);
      characters.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function onLink() {
    try {
      setLinkCode(await endpoints.discordLinkCode());
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Characters</h1>
        <p className="mt-1 text-muted">The bot only pings you about monsters your characters on that world are missing.</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="card p-5 sm:p-6">
          <form onSubmit={onAdd} className="mb-6 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
            <div>
              <input
                className={`input ${errors.name ? 'border-danger' : ''}`}
                placeholder="Character name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={30}
              />
              {errors.name && <p className="mt-1 text-xs font-medium text-danger">{errors.name}</p>}
            </div>
            <div>
              <select className={`input ${errors.server_name ? 'border-danger' : ''}`} value={server} onChange={(e) => setServer(e.target.value)} required>
                <option value="">World…</option>
                {worlds.data?.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              {errors.server_name && <p className="mt-1 text-xs font-medium text-danger">{errors.server_name}</p>}
            </div>
            <button className="btn-primary" type="submit">
              <PlusIcon />
              Add
            </button>
          </form>

          {characters.loading && !characters.data ? (
            <p className="text-sm text-muted">Wczytywanie…</p>
          ) : characters.data?.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              You have no characters yet. Add your first one above.
            </div>
          ) : (
            <ul className="space-y-2">
              {characters.data?.map((c) => (
                <li key={c.id} className="group flex items-center gap-3 rounded-xl border border-line bg-raised/40 px-3.5 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display font-bold text-accent-strong">
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <span className="mt-0.5 inline-block rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line">
                      {c.server_name}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg p-2 text-subtle transition hover:bg-danger-soft hover:text-danger"
                    onClick={() => onDelete(c.id, c.name)}
                    title={`Delete ${c.name}`}
                    aria-label={`Delete ${c.name}`}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card overflow-hidden">
          <div className="bg-[#5865F2] px-5 py-4 text-white">
            <h2 className="font-semibold">Discord</h2>
            <p className="mt-0.5 text-sm text-white/80">Pings in alerts, the “Killed” button and /report</p>
          </div>
          <div className="p-5">
            {me.data?.discord_linked ? (
              <p className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CheckIcon className="h-3 w-3" />
                </span>
                <span>
                  Linked to Discord{me.data.discord_username ? <> as <strong>{me.data.discord_username}</strong></> : ''}. The bot will ping you about
                  Wardens you are missing.
                </span>
              </p>
            ) : (
              <div className="space-y-3">
                <DiscordButton mode="link" label="Link with Discord" />
                {linkCode ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted">Type this on Discord:</p>
                    <code className="block rounded-xl border border-line bg-raised px-3 py-2.5 font-mono text-sm select-all">
                      /link code:{linkCode.code}
                    </code>
                    <p className="text-xs text-subtle">Code valid until {formatClock(linkCode.expires_at)}.</p>
                    <button type="button" className="btn-ghost w-full" onClick={me.reload}>
                      Check connection
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn-ghost w-full" onClick={onLink}>
                    Generate a /link code
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
