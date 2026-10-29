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
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="mb-8 text-center">
        <div className="mb-3 flex justify-center">
          <Brand size="lg" />
        </div>
        <p className="text-muted">Bestiary and Warden alerts for your guild</p>
      </div>

      <div className="card w-full max-w-sm p-6 sm:p-7">
        <h1 className="mb-5 text-lg font-semibold">{mode === 'login' ? 'Log in' : 'Create account'}</h1>

        <DiscordButton
          mode="login"
          label="Log in with Discord"
          after={
            <div className="my-5 flex items-center gap-3 text-xs tracking-wider text-subtle uppercase">
              <span className="h-px flex-1 bg-line" />
              or with e-mail
              <span className="h-px flex-1 bg-line" />
            </div>
          }
        />

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="label">E-mail</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>

      <p className="mt-5 text-sm text-muted">
        {mode === 'login' ? 'No account yet? ' : 'Already have an account? '}
        <button
          type="button"
          className="font-semibold text-accent hover:text-accent-strong hover:underline"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </button>
      </p>
    </div>
  );
}
