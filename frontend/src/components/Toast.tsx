import { createContext, use, useCallback, useState, type ReactNode } from 'react';
import { CheckIcon, XIcon } from './Icons';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null);

const marks: Record<ToastKind, string> = {
  success: 'text-success',
  error: 'text-error',
  info: 'text-accent-text',
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId++;
      setToasts((all) => [...all, { id, kind, message }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-(--z-toast) flex flex-col items-end gap-2 sm:left-auto">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="panel pointer-events-auto flex w-full max-w-sm items-start gap-3 py-2 pr-2 pl-4 text-sm text-ink"
          >
            <span className={`mt-1 shrink-0 ${marks[toast.kind]}`}>{toast.kind === 'error' ? <XIcon /> : <CheckIcon />}</span>
            <span className="flex-1 py-0.5">{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} className="btn-quiet min-w-10 justify-center" aria-label="Close">
              <XIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const show = use(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
