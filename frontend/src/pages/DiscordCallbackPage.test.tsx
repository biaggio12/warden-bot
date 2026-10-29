import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import { AuthProvider } from '../auth/AuthContext';
import DiscordCallbackPage from './DiscordCallbackPage';

vi.mock('../api/endpoints', () => ({ endpoints: { discordAuth: vi.fn() } }));

const user = { id: 1, email: null, display_name: 'Łukasz', discord_linked: true, discord_username: 'Łukasz' };

function visit(query: string, saved: { state: string; mode: string } | null) {
  sessionStorage.clear();
  localStorage.clear();
  if (saved) sessionStorage.setItem('warden-tracker.discord-oauth', JSON.stringify(saved));
  vi.stubGlobal('location', { ...window.location, search: query, pathname: '/auth/discord/callback', replace: vi.fn() });
  render(
    <AuthProvider>
      <DiscordCallbackPage />
    </AuthProvider>,
  );
}

describe('DiscordCallbackPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs in with the code and goes to the report page', async () => {
    vi.mocked(endpoints.discordAuth).mockResolvedValue({ token: 'tok', expires_at: '', user });

    visit('?code=c1&state=s1', { state: 's1', mode: 'login' });

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/#report'));
    expect(endpoints.discordAuth).toHaveBeenCalledWith('c1');
    expect(JSON.parse(localStorage.getItem('warden-tracker.session')!)).toEqual({ token: 'tok', label: 'Łukasz' });
  });

  it('returns to the characters page after linking', async () => {
    vi.mocked(endpoints.discordAuth).mockResolvedValue({ user });

    visit('?code=c2&state=s2', { state: 's2', mode: 'link' });

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/#characters'));
  });

  it('refuses a callback with a forged state without calling the API', async () => {
    visit('?code=c3&state=evil', { state: 's3', mode: 'login' });

    expect(await screen.findByText(/Invalid response/)).toBeInTheDocument();
    expect(endpoints.discordAuth).not.toHaveBeenCalled();
  });

  it('shows a message when the player cancels on Discord', async () => {
    visit('?error=access_denied&state=s4', { state: 's4', mode: 'login' });

    expect(await screen.findByText(/cancelled/)).toBeInTheDocument();
  });
});
