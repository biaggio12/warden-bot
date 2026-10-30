import { useTheme, type Theme } from '../lib/theme';
import { MonitorIcon, MoonIcon, SunIcon } from './Icons';

const OPTIONS: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light theme', Icon: SunIcon },
  { value: 'dark', label: 'Dark theme', Icon: MoonIcon },
  { value: 'system', label: 'System theme', Icon: MonitorIcon },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]!;
  const next = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length]!;

  return (
    <>
      {/* Phones: one button cycling light -> dark -> system. */}
      <button
        type="button"
        className="btn min-w-10 shrink-0 px-2 sm:hidden"
        onClick={() => setTheme(next.value)}
        aria-label={`${current.label} (switch to: ${next.label.toLowerCase()})`}
        title={current.label}
      >
        <current.Icon />
      </button>
      <div role="radiogroup" aria-label="Theme" className="cells hidden shrink-0 sm:flex">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`cell min-w-10 px-2 ${theme === value ? 'cell-on' : ''}`}
          >
            <Icon />
          </button>
        ))}
      </div>
    </>
  );
}
