import type { ReactNode } from 'react';
import { endpoints } from '../api/endpoints';
import { startDiscordAuth, type DiscordAuthMode } from '../lib/discordAuth';
import { useAsync } from '../lib/useAsync';

function DiscordLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4.5 w-4.5 fill-current">
      <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.1 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.7ZM8 15.4c-1.2 0-2.1-1.1-2.1-2.4S6.8 10.6 8 10.6s2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" />
    </svg>
  );
}

/**
 * Renders nothing while Discord login is not configured on the backend.
 * `after` (e.g. an "or" divider) is shown only together with the button.
 */
export default function DiscordButton({ mode, label, after }: { mode: DiscordAuthMode; label: string; after?: ReactNode }) {
  const config = useAsync(endpoints.discordConfig, []);
  const url = config.data?.enabled ? config.data.authorize_url : null;
  if (!url) return null;

  return (
    <>
      <button
        type="button"
        className="btn w-full bg-[#5865F2] text-white shadow-sm hover:bg-[#4752c4] active:translate-y-px"
        onClick={() => startDiscordAuth(url, mode)}
      >
        <DiscordLogo />
        {label}
      </button>
      {after}
    </>
  );
}
