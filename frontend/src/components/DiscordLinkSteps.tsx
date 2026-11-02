import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import { formatClock } from '../lib/time';
import DiscordButton from './DiscordButton';
import { useToast } from './Toast';

/**
 * The two ways to link an e-mail account to Discord: log in with Discord here, or
 * generate a code and type /link on the server. `onCheck` re-reads the account.
 */
export default function DiscordLinkSteps({ onCheck }: { onCheck: () => void }) {
  const toast = useToast();
  const [linkCode, setLinkCode] = useState<{ code: string; expires_at: string } | null>(null);

  async function onGenerate() {
    try {
      setLinkCode(await endpoints.discordLinkCode());
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="space-y-3">
      <DiscordButton mode="link" label="Link with Discord" after={<p className="text-center text-sm text-subtle">or</p>} />
      {linkCode ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted">Type this in any channel on the Warden Discord server:</p>
          <code className="block bg-paper px-3 py-2.5 font-mono text-base font-semibold select-all">/link code:{linkCode.code}</code>
          <p className="text-muted">Code valid until {formatClock(linkCode.expires_at)}.</p>
          <button type="button" className="btn w-full" onClick={onCheck}>
            Check connection
          </button>
        </div>
      ) : (
        <button type="button" className="btn w-full" onClick={onGenerate}>
          Generate a /link code
        </button>
      )}
    </div>
  );
}
