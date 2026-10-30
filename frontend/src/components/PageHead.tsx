import type { ReactNode } from 'react';

/** A screen's title in the pixel face, one line under it, and anything that sits beside it. */
export function PageHead({ title, lead, aside }: { title: string; lead: string; aside?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <h1>{title}</h1>
        <p className="mt-2 text-muted">{lead}</p>
      </div>
      {aside}
    </div>
  );
}

/** What is empty, why it matters, and the one action that fills it. */
export function EmptyState({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="panel max-w-xl p-8">
      <h1>{title}</h1>
      <p className="mt-3 mb-6 text-muted">{text}</p>
      <a href={href} className="btn-primary">
        {action}
      </a>
    </div>
  );
}
