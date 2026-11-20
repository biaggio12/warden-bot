import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import { useToast } from './Toast';

type Notice = 'down' | 'back';

const QUESTION: Record<Notice, string> = {
  down: 'Post "bot down for an update" in every alert channel now?',
  back: 'Post "bot is back" in every alert channel now?',
};

/**
 * Admins: around a deploy, the bot posts in every alert channel, on every Discord server,
 * that it is down for a moment (before) and that it works again (after). Same notices as
 * /maintenance start and /maintenance end.
 */
export default function BotMaintenanceSection({ onPosted }: { onPosted?: () => void }) {
  const toast = useToast();
  const [minutes, setMinutes] = useState('15');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(notice: Notice) {
    setBusy(true);
    try {
      const note = message.trim() || null;
      if (notice === 'down') {
        await endpoints.admin.botMaintenance(minutes === '' ? null : Number(minutes), note);
        toast('Maintenance notice sent: the bot posts it in every alert channel.', 'success');
      } else {
        await endpoints.admin.botBackOnline(note);
        toast('"Bot is back" notice sent: the bot posts it in every alert channel.', 'success');
      }
      setMessage('');
      setConfirming(null);
      onPosted?.();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10" aria-labelledby="bot-maintenance">
      <h2 id="bot-maintenance">Bot maintenance notice</h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Around a deploy, tell the players on Discord that the bot is down for a moment, and that it is back once the new version runs. The bot posts it
        in every alert channel, on every server.
      </p>

      <div className="panel grid gap-4 p-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="block space-y-2">
          <span className="label">Back in (minutes)</span>
          <input
            className="input"
            type="number"
            min={1}
            max={240}
            placeholder="Not sure"
            value={minutes}
            disabled={busy || confirming !== null}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label className="block min-w-0 space-y-2">
          <span className="label">Note for the players (optional)</span>
          <input
            className="input"
            type="text"
            maxLength={500}
            placeholder="e.g. New: element sensitivities in the alerts"
            value={message}
            disabled={busy || confirming !== null}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
          {confirming ? (
            <>
              <span className="text-sm">{QUESTION[confirming]}</span>
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => post(confirming)}>
                {busy ? 'Sending…' : 'Yes, post it'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setConfirming('down')}>
                Post &quot;bot down&quot;
              </button>
              <button type="button" className="btn-primary" onClick={() => setConfirming('back')}>
                Post &quot;bot is back&quot;
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-muted sm:col-span-2">&quot;Back in&quot; is only used for &quot;bot down&quot;; the note goes with either.</p>
      </div>
    </section>
  );
}
