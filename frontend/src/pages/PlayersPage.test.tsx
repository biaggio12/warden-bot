import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { Player } from '../api/types';
import { ToastProvider } from '../components/Toast';
import PlayersPage from './PlayersPage';

vi.mock('../api/endpoints', () => ({
  endpoints: {
    players: vi.fn(),
    worlds: vi.fn(),
    admin: { block: vi.fn(), unblock: vi.fn(), unlinkDiscord: vi.fn(), deleteUser: vi.fn(), addCharacter: vi.fn(), deleteCharacter: vi.fn() },
  },
}));

const renderPage = () =>
  render(
    <ToastProvider>
      <PlayersPage />
    </ToastProvider>,
  );

const players: Player[] = [
  {
    id: 2, email: 'lukasz@example.com', discord_username: null, discord_linked: false, is_admin: false, blocked: false, created_at: '2026-10-30T08:00:00Z',
    characters: [], reports: 0, last_report_at: null, bestiary_marks: 0,
  },
  {
    id: 1, email: null, discord_username: 'Rival', discord_linked: true, is_admin: true, blocked: false, created_at: '2026-10-29T08:00:00Z',
    characters: [{ id: 'c9', name: 'Old Druid', server_name: 'Secura' }], reports: 3, last_report_at: '2026-10-30T07:00:00Z', bestiary_marks: 412,
  },
];

describe('PlayersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(endpoints.worlds).mockResolvedValue(['Monza', 'Secura']);
  });

  it('lists every account with its Discord, characters and activity', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    renderPage();

    expect(await screen.findByText('2 accounts, newest first.')).toBeInTheDocument();
    expect(screen.getByText('lukasz@example.com')).toBeInTheDocument();
    expect(screen.getByText('Discord not linked')).toBeInTheDocument();
    expect(screen.getByText('Discord Rival')).toBeInTheDocument();
    expect(screen.getByText('Old Druid (Secura)')).toBeInTheDocument();
    expect(screen.getByText('3 reports')).toBeInTheDocument();
    expect(screen.getByText('412 in bestiary')).toBeInTheDocument();
  });

  it('filters by e-mail, Discord name or character', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    renderPage();
    await screen.findByText('lukasz@example.com');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search players' }), 'druid');

    expect(screen.queryByText('lukasz@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Discord Rival')).toBeInTheDocument();
  });

  it('blocks a player and shows it on the row', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.block).mockResolvedValue({ ...players[0]!, blocked: true });
    renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Block' }));

    expect(endpoints.admin.block).toHaveBeenCalledWith(2);
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeInTheDocument();
  });

  it('offers no account actions on an admin, only their characters', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.players).mockResolvedValue(players);
    renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[1]!);

    const account = screen.getByRole('region', { name: 'Account of Rival' });
    expect(within(account).getByText(/cannot be blocked, unlinked or deleted/)).toBeInTheDocument();
    expect(within(account).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Old Druid' })).toBeInTheDocument();
  });

  it('deletes an account only after confirming', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.deleteUser).mockResolvedValue(undefined);
    renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(endpoints.admin.deleteUser).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(endpoints.admin.deleteUser).toHaveBeenCalledWith(2);
    expect(await screen.findByText('1 account, newest first.')).toBeInTheDocument();
    expect(screen.queryByText('lukasz@example.com')).not.toBeInTheDocument();
  });

  it('adds a character to another player', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.addCharacter).mockResolvedValue({ ...players[0]!, characters: [{ id: 'c1', name: 'New Knight', server_name: 'Monza' }] });
    renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    const characters = screen.getByRole('region', { name: 'Characters of lukasz@example.com' });
    await user.type(within(characters).getByRole('textbox', { name: 'Character name' }), 'New Knight');
    await user.selectOptions(await within(characters).findByRole('combobox', { name: 'World' }), 'Monza');
    await user.click(within(characters).getByRole('button', { name: 'Add' }));

    expect(endpoints.admin.addCharacter).toHaveBeenCalledWith(2, 'New Knight', 'Monza');
    expect(await screen.findByText('New Knight (Monza)')).toBeInTheDocument();
  });
});
