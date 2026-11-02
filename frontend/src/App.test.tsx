import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { endpoints } from './api/endpoints';
import type { Me } from './api/types';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';

vi.mock('./api/endpoints', () => ({
  endpoints: {
    me: vi.fn(),
    characters: vi.fn(),
    worlds: vi.fn(),
    cities: vi.fn(),
    monsters: vi.fn(),
    activeSpawns: vi.fn(),
    discordGuilds: vi.fn(),
    discordConfig: vi.fn(),
    createCharacter: vi.fn(),
  },
}));

const mocked = vi.mocked(endpoints);
const emailUser: Me = { id: 1, email: 'player@example.com', display_name: 'player@example.com', discord_linked: false, discord_username: null };

function renderApp() {
  render(
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>,
  );
}

describe('App on first login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('warden-tracker.session', JSON.stringify({ token: 't', label: 'player@example.com' }));
    sessionStorage.clear();
    window.location.hash = '';
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocked.me.mockResolvedValue(emailUser);
    mocked.characters.mockResolvedValue([]);
    mocked.worlds.mockResolvedValue(['Monza']);
    mocked.cities.mockResolvedValue([]);
    mocked.monsters.mockResolvedValue([]);
    mocked.activeSpawns.mockResolvedValue([]);
    mocked.discordGuilds.mockResolvedValue([]);
    mocked.discordConfig.mockResolvedValue({ enabled: false, authorize_url: null });
  });

  it('opens the welcome dialog for an account without characters, once per session', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole('dialog', { name: 'Welcome! Add your characters' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // An e-mail account is reminded to link Discord.
    expect(screen.getByText('Your account is not linked to Discord')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to link it' })).toHaveAttribute('href', '#characters');
  });

  it('reloads the page behind once a character is added', async () => {
    const user = userEvent.setup();
    mocked.me.mockResolvedValue({ ...emailUser, discord_linked: true, discord_username: 'lukasz' });
    mocked.createCharacter.mockResolvedValue({ id: 'c1', name: 'Sir Tester', server_name: 'Monza' });
    renderApp();

    await screen.findByRole('dialog');
    expect(screen.getByText('Add a character to report Wardens')).toBeInTheDocument();
    mocked.characters.mockResolvedValue([{ id: 'c1', name: 'Sir Tester', server_name: 'Monza' }]);
    await user.type(screen.getByRole('textbox', { name: 'Character name' }), 'Sir Tester');
    await user.selectOptions(screen.getByRole('combobox', { name: 'World' }), 'Monza');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByText('Add a character to report Wardens')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Your account is not linked to Discord')).not.toBeInTheDocument();
  });

  it('does not open for an account that already has characters', async () => {
    mocked.characters.mockResolvedValue([{ id: 'c1', name: 'Sir Tester', server_name: 'Monza' }]);
    renderApp();

    expect(await screen.findByText('Your account is not linked to Discord')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
