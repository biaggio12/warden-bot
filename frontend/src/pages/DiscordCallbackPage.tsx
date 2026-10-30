import { useEffect, useState } from 'react';
import { endpoints } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { consumeDiscordState } from '../lib/discordAuth';

/** Authorization codes are single-use; StrictMode would otherwise run the exchange twice. */
const handledCodes = new Set<string>();

/** Full navigation back into the app; the session is already in localStorage. */
function leaveTo(hash: string) {
  window.location.replace(`/${hash}`);
}

export default function DiscordCallbackPage() {
  const { acceptLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && handledCodes.has(code)) return;

    const mode = consumeDiscordState(params.get('state'));
    if (params.get('error')) {
      setError('Logging in with Discord was cancelled.');
      return;
    }
    if (!code || !mode) {
      setError('Invalid response from Discord. Please try again.');
      return;
    }
    handledCodes.add(code);

    endpoints.discordAuth(code).then(
      (res) => {
        if ('token' in res) acceptLogin(res);
        leaveTo(mode === 'link' ? '#characters' : '#report');
      },
      (err: Error) => setError(err.message),
    );
  }, [acceptLogin]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 text-ink">
      <div className="panel w-full max-w-sm p-8">
        {error ? (
          <>
            <p className="mb-6 text-hp">{error}</p>
            <a href="/" className="btn">
              Back
            </a>
          </>
        ) : (
          <p className="text-muted">Connecting to Discord…</p>
        )}
      </div>
    </div>
  );
}
