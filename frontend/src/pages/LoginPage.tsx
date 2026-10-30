import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import Brand from '../components/Brand';
import DiscordButton from '../components/DiscordButton';
import ThemeToggle from '../components/ThemeToggle';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? login : register)(email, password);
    } catch (err) {
      const fields = err instanceof ApiError ? Object.values(err.fieldErrors) : [];
      setError(fields[0] ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-6xl justify-end px-4 pt-4 sm:px-6">
        <ThemeToggle />
      </div>

      <div className="mx-auto grid max-w-6xl items-start gap-x-16 gap-y-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:py-24">
        <div className="lg:mt-10">
          <Brand size="lg" />
          <p className="mt-6 max-w-md text-lg text-ink-2">Bestiary and Warden alerts for your guild</p>
        </div>

        <div className="panel p-6 sm:p-8">
          <h2 className="mb-6">{mode === 'login' ? 'Log in' : 'Create account'}</h2>

          <DiscordButton
            mode="login"
            label="Log in with Discord"
            after={
              <div className="my-6 flex items-center gap-3 text-sm text-muted">
                <span className="h-0.5 flex-1 bg-rule" />
                or with e-mail
                <span className="h-0.5 flex-1 bg-rule" />
              </div>
            }
          />

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block space-y-2">
              <span className="label">E-mail</span>
              <input className="input" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block space-y-2">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                name="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p className="border-l-4 border-hp pl-3 text-sm text-hp">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted">
            {mode === 'login' ? 'No account yet? ' : 'Already have an account? '}
            <button
              type="button"
              className="font-semibold text-accent-text underline-offset-4 hover:underline"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
