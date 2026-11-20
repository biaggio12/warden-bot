import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronIcon } from './Icons';

const STORAGE_KEY = 'collapsible-sections';
const OPEN_EVENT = 'collapsible-section:open';

/** Opens the section with this id (if it is on the page) and scrolls to it. */
export function openSection(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: id }));
}

function remembered(id: string): boolean | undefined {
  try {
    const value = (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>)[id];
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

function remember(id: string, open: boolean): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [id]: open }));
  } catch {
    // Private window or blocked storage: the section just opens as by default next time.
  }
}

/**
 * A section whose heading opens and closes it; the viewer's choice is remembered in this
 * browser. A closed section does not render its content, so it loads nothing either.
 */
export default function CollapsibleSection({
  id,
  title,
  defaultOpen = false,
  summary,
  children,
}: {
  /** Unique on the page: the heading's id and the key of the remembered state. */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Short text next to the heading, shown open or closed (e.g. a count). */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => remembered(id) ?? defaultOpen);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) return;
      setOpen(true);
      remember(id, true);
      ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [id]);
  const bodyId = `${id}-body`;

  function toggle() {
    setOpen((was) => {
      remember(id, !was);
      return !was;
    });
  }

  return (
    <section ref={ref} className="mt-10 scroll-mt-4" aria-labelledby={id}>
      <h2 id={id} className="flex flex-wrap items-baseline gap-x-3">
        <button
          type="button"
          className="-ml-1 inline-flex items-center gap-2 px-1 text-left hover:text-accent-text"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={toggle}
        >
          <ChevronIcon className={`h-5 w-5 shrink-0 transition-transform duration-(--dur-micro) ${open ? 'rotate-180' : ''}`} aria-hidden />
          {title}
        </button>
        {summary && <span className="text-sm font-normal text-muted">{summary}</span>}
      </h2>
      {open && (
        <div id={bodyId} className="mt-4">
          {children}
        </div>
      )}
    </section>
  );
}
