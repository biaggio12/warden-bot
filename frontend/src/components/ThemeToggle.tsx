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
        className="btn-ghost p-2 sm:hidden"
        onClick={() => setTheme(next.value)}
        aria-label={`${current.label} (switch to: ${next.label.toLowerCase()})`}
        title={current.label}
      >
        <current.Icon />
      </button>
      <ThemeSegments theme={theme} setTheme={setTheme} />
    </>
  );
}

function ThemeSegments({ theme, setTheme }: ReturnType<typeof useTheme>) {
  return (
    <div role="radiogroup" aria-label="Theme" className="hidden rounded-xl border border-line bg-raised p-0.5 sm:flex">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={`rounded-[10px] p-1.5 transition ${
            theme === value ? 'bg-surface text-accent shadow-sm' : 'text-subtle hover:text-fg'
          }`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
