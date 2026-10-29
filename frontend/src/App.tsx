import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import Brand from './components/Brand';
import { BookIcon, ChartIcon, LogOutIcon, SwordsIcon, UsersIcon } from './components/Icons';
import ThemeToggle from './components/ThemeToggle';
import { DISCORD_CALLBACK_PATH } from './lib/discordAuth';
import BestiaryPage from './pages/BestiaryPage';
import CharactersPage from './pages/CharactersPage';
import DiscordCallbackPage from './pages/DiscordCallbackPage';
import LoginPage from './pages/LoginPage';
import ReportPage from './pages/ReportPage';
import StatsPage from './pages/StatsPage';

const TABS = [
  { id: 'report', label: 'Report a Warden', short: 'Report', Icon: SwordsIcon },
  { id: 'bestiary', label: 'Bestiary', short: 'Bestiary', Icon: BookIcon },
  { id: 'stats', label: 'Stats', short: 'Stats', Icon: ChartIcon },
  { id: 'characters', label: 'Characters', short: 'Characters', Icon: UsersIcon },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const hash = window.location.hash.slice(1);
  return TABS.some((t) => t.id === hash) ? (hash as TabId) : 'report';
}

export default function App() {
  const { session, logout } = useAuth();
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (window.location.pathname === DISCORD_CALLBACK_PATH) return <DiscordCallbackPage />;
  if (!session) return <LoginPage />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Brand />
          <nav className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
            {TABS.map(({ id, label, short, Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={tab === id ? 'page' : undefined}
                aria-label={label}
                className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-1.5 py-2 text-sm font-medium transition sm:flex-none sm:px-3.5 ${
                  tab === id ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden max-w-48 truncate text-sm text-muted lg:inline" title={session.label}>
              {session.label}
            </span>
            <button type="button" className="btn-ghost px-3 py-2" onClick={logout} title="Log out">
              <LogOutIcon />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {tab === 'report' && <ReportPage />}
        {tab === 'bestiary' && <BestiaryPage />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'characters' && <CharactersPage />}
      </main>
    </div>
  );
}
