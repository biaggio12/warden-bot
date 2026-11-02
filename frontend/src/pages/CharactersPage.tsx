import { endpoints } from '../api/endpoints';
import AddCharacterForm from '../components/AddCharacterForm';
import DiscordLinkSteps from '../components/DiscordLinkSteps';
import { CheckIcon, TrashIcon } from '../components/Icons';
import { PageHead } from '../components/PageHead';
import { useToast } from '../components/Toast';
import { useAsync } from '../lib/useAsync';

export default function CharactersPage() {
  const toast = useToast();
  const characters = useAsync(endpoints.characters, []);
  const me = useAsync(endpoints.me, []);

  async function onDelete(id: string, characterName: string) {
    if (!window.confirm(`Delete ${characterName} together with their bestiary?`)) return;
    try {
      await endpoints.deleteCharacter(id);
      characters.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <>
      <PageHead title="Characters" lead="The bot only pings you about monsters your characters on that world are missing." />

      <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="panel p-5 sm:p-6">
          <AddCharacterForm onAdded={characters.reload} />

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
              <DiscordLinkSteps onCheck={me.reload} />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
