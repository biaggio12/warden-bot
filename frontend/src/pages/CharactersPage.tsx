import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import DiscordButton from '../components/DiscordButton';
import { CheckIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { PageHead } from '../components/PageHead';
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
    <>
      <PageHead title="Characters" lead="The bot only pings you about monsters your characters on that world are missing." />

      <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="panel p-5 sm:p-6">
          <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
            <div>
              <input
                className={`input ${errors.name ? 'border-hp' : ''}`}
                placeholder="Character name"
                aria-label="Character name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={30}
              />
              {errors.name && <p className="mt-1.5 text-sm font-medium text-hp">{errors.name}</p>}
            </div>
            <div>
              <select
                className={`input ${errors.server_name ? 'border-hp' : ''}`}
                aria-label="World"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                required
              >
                <option value="">World…</option>
                {worlds.data?.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              {errors.server_name && <p className="mt-1.5 text-sm font-medium text-hp">{errors.server_name}</p>}
            </div>
            <button className="btn-primary" type="submit">
              <PlusIcon />
              Add
            </button>
          </form>

          {characters.loading && !characters.data ? (
            <p className="mt-6 text-muted">Loading…</p>
          ) : characters.data?.length === 0 ? (
            <p className="mt-6 border-3 border-dashed border-rule px-4 py-6 text-muted">You have no characters yet. Add your first one above.</p>
          ) : (
            <table className="mt-6 w-full">
              <thead>
                <tr className="border-b-3 border-outline text-left text-sm text-muted">
                  <th scope="col" className="py-2 font-medium">Character</th>
                  <th scope="col" className="py-2 font-medium">World</th>
                  <th scope="col" className="w-12 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {characters.data?.map((c) => (
                  <tr key={c.id} className="border-b-2 border-rule">
                    <td className="max-w-0 truncate py-2.5 font-semibold">{c.name}</td>
                    <td className="py-2 text-muted">{c.server_name}</td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        className="btn-quiet min-w-10 justify-center hover:text-hp"
                        onClick={() => onDelete(c.id, c.name)}
                        title={`Delete ${c.name}`}
                        aria-label={`Delete ${c.name}`}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="panel">
          <div className="border-b-3 border-outline bg-discord px-5 py-4 text-discord-ink">
            <h2>Discord</h2>
            <p className="mt-1 text-sm">Pings in alerts, the “Killed” button and /report</p>
          </div>
          <div className="p-5">
            {me.data?.discord_linked ? (
              <p className="flex items-start gap-2.5 text-sm">
                <CheckIcon className="mt-0.5 h-4 w-4 text-xp" />
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
                    <code className="block bg-paper px-3 py-2.5 font-mono text-base font-semibold select-all">/link code:{linkCode.code}</code>
                    <p className="text-muted">Code valid until {formatClock(linkCode.expires_at)}.</p>
                    <button type="button" className="btn w-full" onClick={me.reload}>
                      Check connection
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn w-full" onClick={onLink}>
                    Generate a /link code
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
