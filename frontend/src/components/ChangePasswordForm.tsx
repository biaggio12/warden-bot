import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useToast } from './Toast';

const MIN_LENGTH = 8;

/** For e-mail accounts, e.g. after an admin reset the password to a temporary one. */
export default function ChangePasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (next.length < MIN_LENGTH) {
      setErrors({ new_password: `At least ${MIN_LENGTH} characters.` });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await endpoints.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast('Password changed. Your other sessions were logged out.', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.problem?.violations) setErrors(err.fieldErrors);
      else toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Change password">
      <div>
        <input
          type="password"
          className={`input ${errors.current_password ? 'border-hp' : ''}`}
          aria-label="Current password"
          placeholder="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        {errors.current_password && <p className="mt-1.5 text-sm font-medium text-hp">{errors.current_password}</p>}
      </div>
      <div>
        <input
          type="password"
          className={`input ${errors.new_password ? 'border-hp' : ''}`}
          aria-label="New password"
          placeholder={`New password (${MIN_LENGTH}+ characters)`}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        {errors.new_password && <p className="mt-1.5 text-sm font-medium text-hp">{errors.new_password}</p>}
      </div>
      <button type="submit" className="btn w-full" disabled={saving || !current || !next}>
        {saving ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
