import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { Character } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { PlusIcon } from './Icons';
import { useToast } from './Toast';

type Props = {
  onAdded: (character: Character) => void;
  autoFocus?: boolean;
  /** Who gets the character: the player's own account unless an admin passes another. */
  create?: (name: string, serverName: string) => Promise<Character>;
};

/** Name + world + [Add]: the Characters tab, the welcome dialog and the admin's Players tab. */
export default function AddCharacterForm({ onAdded, autoFocus = false, create = endpoints.createCharacter }: Props) {
  const toast = useToast();
  const worlds = useAsync(endpoints.worlds, []);
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setSaving(true);
    try {
      const character = await create(name.trim(), server);
      setName('');
      toast(`Added ${character.name}.`, 'success');
      onAdded(character);
    } catch (err) {
      if (err instanceof ApiError && err.problem?.violations) setErrors(err.fieldErrors);
      else toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
      <div>
        <input
          className={`input ${errors.name ? 'border-hp' : ''}`}
          placeholder="Character name"
          aria-label="Character name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={30}
          autoFocus={autoFocus}
        />
        {errors.name && <p className="mt-1.5 text-sm font-medium text-hp">{errors.name}</p>}
      </div>
      <div>
        <select
          className={`input ${errors.server_name ? 'border-hp' : ''}`}
          aria-label="World"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          required
        >
          <option value="">World…</option>
          {worlds.data?.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        {errors.server_name && <p className="mt-1.5 text-sm font-medium text-hp">{errors.server_name}</p>}
      </div>
      <button className="btn-primary" type="submit" disabled={saving}>
        <PlusIcon />
        Add
      </button>
    </form>
  );
}
