import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { configureApi } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { AuthResponse } from '../api/types';

const STORAGE_KEY = 'warden-tracker.session';

interface Session {
  token: string;
  /** E-mail, or the Discord name for accounts without one. */
  label: string;
}

interface AuthContextValue {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  /** Stores the session from any login response (e.g. "Log in with Discord"). */
  acceptLogin: (response: AuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Session> & { email?: string };
    // Sessions saved before Discord login stored "email" instead of "label".
    return stored.token ? { token: stored.token, label: stored.label ?? stored.email ?? '' } : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode) - session lives in memory only
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);

  const update = useCallback((next: Session | null) => {
    writeSession(next);
    setSession(next);
  }, []);

  // Configured during render so the very first requests already carry the token.
  configureApi({ token: () => session?.token ?? null, onUnauthorized: () => update(null) });

  const value = useMemo<AuthContextValue>(() => {
    const acceptLogin = (res: AuthResponse) => update({ token: res.token, label: res.user.display_name });
    return {
      session,
      login: async (email, password) => acceptLogin(await endpoints.login(email, password)),
      register: async (email, password) => acceptLogin(await endpoints.register(email, password)),
      acceptLogin,
      logout: () => update(null),
    };
  }, [session, update]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
