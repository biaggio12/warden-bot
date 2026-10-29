/** Must match DISCORD_OAUTH_REDIRECT_URI on the backend and the Redirects list in the Discord portal. */
export const DISCORD_CALLBACK_PATH = '/auth/discord/callback';

const STATE_KEY = 'warden-tracker.discord-oauth';

export type DiscordAuthMode = 'login' | 'link';

/**
 * Sends the browser to Discord. A random `state` is kept in sessionStorage and checked on
 * return, so a callback URL crafted by someone else (login CSRF) is rejected.
 */
export function startDiscordAuth(authorizeUrl: string, mode: DiscordAuthMode): void {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, mode }));
  } catch {
    // without storage the callback cannot verify the state and will refuse the login
  }
  window.location.assign(`${authorizeUrl}&state=${encodeURIComponent(state)}`);
}

/** Returns the mode the flow was started in, or null when `state` does not match. Single use. */
export function consumeDiscordState(state: string | null): DiscordAuthMode | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    const saved = raw ? (JSON.parse(raw) as { state: string; mode: DiscordAuthMode }) : null;
    return saved && state && saved.state === state ? saved.mode : null;
  } catch {
    return null;
  }
}
