import { useEffect, useState } from 'react';
import { endpoints } from './api/endpoints';
import { useAuth } from './auth/AuthContext';
import Brand from './components/Brand';
import { LogOutIcon } from './components/Icons';
import ThemeToggle from './components/ThemeToggle';
import { DISCORD_CALLBACK_PATH } from './lib/discordAuth';
import { useAsync } from './lib/useAsync';
import BestiaryPage from './pages/BestiaryPage';
import CharactersPage from './pages/CharactersPage';
import DiscordCallbackPage from './pages/DiscordCallbackPage';
import LoginPage from './pages/LoginPage';
import PlayersPage from './pages/PlayersPage';
import ReportPage from './pages/ReportPage';
import StatsPage from './pages/StatsPage';

const TABS = [
  { id: 'report', label: 'Report a Warden', short: 'Report' },
  { id: 'bestiary', label: 'Bestiary', short: 'Bestiary' },
  { id: 'stats', label: 'Stats', short: 'Stats' },
  { id: 'characters', label: 'Characters', short: 'Characters' },
] as const;

/** Only for admins (ADMIN_DISCORD_IDS); the API refuses everyone else anyway. */
const ADMIN_TAB = { id: 'players', label: 'Players', short: 'Players' } as const;

type TabId = (typeof TABS)[number]['id'] | typeof ADMIN_TAB.id;

function tabFromHash(): TabId {
  const hash = window.location.hash.slice(1);
  return [...TABS, ADMIN_TAB].some((t) => t.id === hash) ? (hash as TabId) : 'report';
}

export default function App() {
  const { session, logout } = useAuth();
  const [hashTab, setTab] = useState<TabId>(tabFromHash);
  const me = useAsync(() => (session ? endpoints.me() : Promise.resolve(null)), [session?.token]);
  const isAdmin = me.data?.is_admin === true;
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS;
  const tab = hashTab === ADMIN_TAB.id && !isAdmin ? 'report' : hashTab;

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (window.location.pathname === DISCORD_CALLBACK_PATH) return <DiscordCallbackPage />;
  if (!session) return <LoginPage />;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-(--z-sticky-nav) border-b-3 border-outline bg-paper-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 sm:px-6 lg:flex-nowrap lg:gap-x-8 lg:py-3">
          <a href="#report" className="shrink-0" aria-label="Warden Tracker, report a Warden">
            <Brand />
          </a>
          <nav aria-label="Main" className="order-last -mx-2 flex w-full sm:mx-0 sm:gap-2 lg:order-none lg:w-auto lg:shrink-0">
            {tabs.map(({ id, label, short }) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={tab === id ? 'page' : undefined}
                aria-label={label}
                className={`flex min-h-11 flex-1 items-center justify-center border-b-4 px-2 text-sm font-semibold whitespace-nowrap transition-colors duration-(--dur-micro) sm:flex-none sm:px-3 ${
                  tab === id ? 'border-accent text-accent-text' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {/* Short on phones and on narrow desktops, where the tabs share the row with the brand. */}
                <span className="sm:hidden lg:inline xl:hidden">{short}</span>
                <span className="hidden sm:inline lg:hidden xl:inline">{label}</span>
              </a>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <ThemeToggle />
            <span className="hidden max-w-48 min-w-0 truncate text-sm text-muted xl:inline" title={session.label}>
              {session.label}
            </span>
            <button type="button" className="btn min-w-10 shrink-0 px-2 sm:px-3" onClick={logout} title="Log out">
              <LogOutIcon />
              <span className="hidden sm:inline lg:hidden xl:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {tab === 'report' && <ReportPage />}
        {tab === 'bestiary' && <BestiaryPage />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'characters' && <CharactersPage />}
        {tab === 'players' && <PlayersPage />}
      </main>
    </div>
  );
}
