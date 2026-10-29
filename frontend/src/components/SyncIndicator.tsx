import type { SyncStatus } from '../lib/killSync';

const labels: Record<SyncStatus, string> = {
  loading: 'Loading…',
  idle: 'Synced',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

const dots: Record<SyncStatus, string> = {
  loading: 'bg-subtle animate-pulse',
  idle: 'bg-ok',
  saving: 'bg-accent animate-pulse',
  saved: 'bg-ok',
  error: 'bg-danger',
};

export default function SyncIndicator({ status, error, onRetry }: { status: SyncStatus; error: string | null; onRetry: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
        status === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface text-muted ring-1 ring-line'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${dots[status]}`} />
      <span title={error ?? undefined}>{labels[status]}</span>
      {status === 'error' && (
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
