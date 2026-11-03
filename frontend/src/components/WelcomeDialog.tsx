import { useEffect, useRef, useState } from 'react';
import type { Character } from '../api/types';
import AddCharacterForm from './AddCharacterForm';
import DiscordLinkSteps from './DiscordLinkSteps';
import { CheckIcon, XIcon } from './Icons';

type Props = {
  /** E-mail accounts are not linked to Discord yet: the dialog then explains how. */
  discordLinked: boolean;
  onCheckDiscord: () => void;
  /** `added`: whether any character was added, so the page behind can reload. */
  onClose: (added: boolean) => void;
};

/**
 * First login (an account without characters): add a character, and for accounts that
 * logged in by e-mail, link Discord - without both the bot never pings the player.
 */
export default function WelcomeDialog({ discordLinked, onCheckDiscord, onClose }: Props) {
  const [added, setAdded] = useState<Character[]>([]);
  const [step, setStep] = useState<'characters' | 'discord'>('characters');
  const close = () => onClose(added.length > 0);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  const showDiscordStep = !discordLinked;

  return (
    <div className="fixed inset-0 z-(--z-modal) flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="panel w-full max-w-xl">
        <div className="flex items-start justify-between gap-4 border-b-3 border-outline px-5 py-4 sm:px-6">
          <div>
            <p className="text-sm font-semibold text-muted">
              Step {step === 'characters' ? 1 : 2} of {showDiscordStep ? 2 : 1}
            </p>
            <h2 id="welcome-title">{step === 'characters' ? 'Welcome! Add your characters' : 'Link your Discord account'}</h2>
          </div>
          <button type="button" className="btn-quiet min-w-10 justify-center" onClick={close} aria-label="Close">
            <XIcon />
          </button>
        </div>

        {step === 'characters' ? (
          <div className="space-y-5 p-5 sm:p-6">
            <p className="text-muted">
              The bot pings you only about Wardens your characters on that world are still missing in the bestiary. Add every character you hunt
              with.
            </p>
            <AddCharacterForm autoFocus onAdded={(character) => setAdded((list) => [...list, character])} />
            {added.length > 0 && (
              <ul className="space-y-1.5" aria-label="Added characters">
                {added.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <CheckIcon className="h-4 w-4 text-xp" />
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-muted">{c.server_name}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-3 border-t-2 border-rule pt-4">
              <button type="button" className="btn-quiet" onClick={close}>
                Later
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={added.length === 0}
                onClick={() => (showDiscordStep ? setStep('discord') : close())}
              >
                {showDiscordStep ? 'Next' : 'Done'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-5 sm:p-6">
            {discordLinked ? (
              <p className="flex items-start gap-2.5">
                <CheckIcon className="mt-1 h-4 w-4 text-xp" />
                <span>Linked. The bot will ping you about Wardens your characters are missing.</span>
              </p>
            ) : (
              <>
                <p className="text-muted">
                  You logged in with e-mail, so the bot does not know your Discord account yet: no pings, and you cannot report Wardens (here or
                  with /warden). Link it one of two ways:
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>
                    <strong className="text-ink">Link with Discord</strong> - log in to Discord in the window that opens. Fastest.
                  </li>
                  <li>
                    <strong className="text-ink">Generate a /link code</strong> and type the command on the Warden Discord server.
                  </li>
                </ol>
                <DiscordLinkSteps onCheck={onCheckDiscord} />
                <p className="text-sm text-subtle">You can do this later in the Characters tab.</p>
              </>
            )}
            <div className="flex justify-end border-t-2 border-rule pt-4">
              <button type="button" className="btn-primary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
