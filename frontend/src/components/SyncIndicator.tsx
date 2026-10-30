import type { SyncStatus } from '../lib/killSync';
import { CheckIcon, XIcon } from './Icons';

const labels: Record<SyncStatus, string> = {
  loading: 'Loading…',
  idle: 'Synced',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

export default function SyncIndicator({ status, error, onRetry }: { status: SyncStatus; error: string | null; onRetry: () => void }) {
  const done = status === 'idle' || status === 'saved';
  return (
    <div role="status" aria-live="polite" className={`flex min-h-10 items-center gap-2 text-sm ${status === 'error' ? 'text-error' : 'text-muted'}`}>
      {done && <CheckIcon className="h-4 w-4 text-xp" />}
      {status === 'error' && <XIcon className="h-4 w-4" />}
      <span title={error ?? undefined}>{labels[status]}</span>
      {status === 'error' && (
        <button type="button" className="btn ml-1" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
