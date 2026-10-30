import { useId, useMemo, useState } from 'react';
import type { Monster } from '../api/types';
import MonsterImage from './MonsterImage';

interface Props {
  monsters: Monster[];
  value: Monster | null;
  onChange: (monster: Monster | null) => void;
  invalid?: boolean;
}

const MAX_RESULTS = 8;

/** Autocomplete over the monster dictionary; only a picked suggestion counts as a value. */
export default function MonsterCombobox({ monsters, value, onChange, invalid }: Props) {
  const listId = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return monsters.slice(0, MAX_RESULTS);
    const starts = monsters.filter((m) => m.name.toLowerCase().startsWith(needle));
    const contains = monsters.filter((m) => !m.name.toLowerCase().startsWith(needle) && m.name.toLowerCase().includes(needle));
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  }, [monsters, text]);

  function pick(monster: Monster) {
    onChange(monster);
    setText(monster.name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        className={`input ${invalid ? 'border-error' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        placeholder="Start typing, e.g. Dragon…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
          const exact = monsters.find((m) => m.name.toLowerCase() === e.target.value.trim().toLowerCase());
          onChange(exact ?? null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="panel absolute z-(--z-dropdown) mt-1 max-h-72 w-full overflow-auto">
          {matches.map((monster, index) => (
            <li
              key={monster.id}
              id={`${listId}-${monster.id}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(monster);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center gap-3 border-b-2 border-rule px-3 py-1.5 text-sm last:border-b-0 ${
                index === active ? 'bg-accent-soft' : ''
              }`}
            >
              <MonsterImage src={monster.image_url} className="h-8 w-8" />
              <span className="flex-1 font-medium">{monster.name}</span>
              <span className="text-xs text-muted">{monster.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
