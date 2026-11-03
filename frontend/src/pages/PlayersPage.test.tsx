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
    admin: { block: vi.fn(), unblock: vi.fn(), unlinkDiscord: vi.fn(), deleteUser: vi.fn(), addCharacter: vi.fn(), deleteCharacter: vi.fn(), resetPassword: vi.fn(), reports: vi.fn(), deleteReport: vi.fn(), grantModerator: vi.fn(), revokeModerator: vi.fn(), actions: vi.fn(), alertChannels: vi.fn(), setAlertChannel: vi.fn(), resetAlertChannel: vi.fn() },
  },
}));

const renderPage = (isAdmin = true) =>
  render(
    <ToastProvider>
      <PlayersPage isAdmin={isAdmin} />
    </ToastProvider>,
  );

const players: Player[] = [
  {
    id: 2, email: 'lukasz@example.com', discord_username: null, discord_linked: false, is_admin: false, is_moderator: false, blocked: false, created_at: '2026-10-30T08:00:00Z',
    characters: [], reports: 0, last_report_at: null, bestiary_marks: 0,
  },
  {
    id: 1, email: null, discord_username: 'Rival', discord_linked: true, is_admin: true, is_moderator: false, blocked: false, created_at: '2026-10-29T08:00:00Z',
    characters: [{ id: 'c9', name: 'Old Druid', server_name: 'Secura' }], reports: 3, last_report_at: '2026-10-30T07:00:00Z', bestiary_marks: 412,
  },
];

describe('PlayersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(endpoints.worlds).mockResolvedValue(['Monza', 'Secura']);
    vi.mocked(endpoints.admin.actions).mockResolvedValue([]);
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue({ enabled: true, prefix: 'wardens-', worlds: ['Monza'], servers: [], assignments: [] });
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

  it('resets a password and shows the new one once', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.resetPassword).mockResolvedValue({ password: 'abcDEF234xyz', user: players[0]! });
    renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(endpoints.admin.resetPassword).toHaveBeenCalledWith(2);
    expect(await screen.findByText('abcDEF234xyz')).toBeInTheDocument();
    expect(endpoints.admin.actions).toHaveBeenCalledTimes(2); // the history is reloaded
  });

  it('shows the admin history', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.actions).mockResolvedValue([
      { id: 2, admin: 'Rival', player: 'spam@example.com', action: 'block', details: null, created_at: '2026-11-02T09:00:00Z' },
      { id: 1, admin: 'Rival', player: 'lukasz@example.com', action: 'add_character', details: 'New Knight (Monza)', created_at: '2026-11-02T08:00:00Z' },
    ]);
    renderPage();

    const history = await screen.findByRole('region', { name: 'Admin history' });
    const items = within(history).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Rival blocked spam@example.com');
    expect(items[1]).toHaveTextContent('Rival added a character to lukasz@example.com: New Knight (Monza)');
  });

  it('sorts by the number of reports', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    renderPage();
    await screen.findByText('lukasz@example.com');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort players' }), 'reports');

    expect(screen.getByText('2 accounts, most reports first.')).toBeInTheDocument();
    const rows = within(screen.getByRole('region', { name: 'Registered players' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Discord Rival');
  });

  it("shows a player's report stats", async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.reports).mockResolvedValue({
      total: 3,
      last_7_days: 1,
      last_30_days: 2,
      first_report_at: '2026-09-20T10:00:00Z',
      last_report_at: '2026-11-02T07:00:00Z',
      by_status: { active: 0, killed: 1, expired: 2 },
      worlds: [{ server_name: 'Secura', reports: 3 }],
      monsters: [{ name: 'Dragon Warden', image_url: null, reports: 2 }, { name: 'Hydra Warden', image_url: null, reports: 1 }],
      recent: [
        { id: 's1', monster: 'Dragon Warden', image_url: null, server_name: 'Secura', location: 'Darashia dragons', city: 'Darashia', status: 'KILLED', created_at: '2026-11-02T07:00:00Z' },
      ],
    });
    renderPage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reports' }))[1]!);

    expect(endpoints.admin.reports).toHaveBeenCalledWith(1);
    const panel = await screen.findByRole('region', { name: 'Reports of Rival' });
    expect(within(panel).getByText('All time').nextSibling).toHaveTextContent('3');
    expect(within(panel).getByText('Killed', { selector: 'dt' }).nextSibling).toHaveTextContent('1');
    expect(within(panel).getByText('Hydra Warden')).toBeInTheDocument();
    expect(within(panel).getByText('Darashia dragons')).toBeInTheDocument();
    expect(within(panel).getByText('Newest 1 reports')).toBeInTheDocument();
  });

  it('says so when a player has not reported anything', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.reports).mockResolvedValue({
      total: 0, last_7_days: 0, last_30_days: 0, first_report_at: null, last_report_at: null,
      by_status: { active: 0, killed: 0, expired: 0 }, worlds: [], monsters: [], recent: [],
    });
    renderPage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reports' }))[0]!);

    expect(await screen.findByText('lukasz@example.com has not reported any Warden yet.')).toBeInTheDocument();
  });

  it('deletes a report after confirming and refreshes the counts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(endpoints.players).mockResolvedValue(players);
    const stats = {
      total: 1, last_7_days: 1, last_30_days: 1, first_report_at: '2026-11-02T07:00:00Z', last_report_at: '2026-11-02T07:00:00Z',
      by_status: { active: 1, killed: 0, expired: 0 }, worlds: [{ server_name: 'Secura', reports: 1 }],
      monsters: [{ name: 'Dragon Warden', image_url: null, reports: 1 }],
      recent: [{ id: 's1', monster: 'Dragon Warden', image_url: null, server_name: 'Secura', location: 'Fake', city: null, status: 'ACTIVE' as const, created_at: '2026-11-02T07:00:00Z' }],
    };
    vi.mocked(endpoints.admin.reports)
      .mockResolvedValueOnce(stats)
      .mockResolvedValueOnce({ ...stats, total: 0, worlds: [], monsters: [], recent: [] });
    vi.mocked(endpoints.admin.deleteReport).mockResolvedValue({ user: { ...players[1]!, reports: 2 } });
    renderPage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reports' }))[1]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete the report of Dragon Warden on Secura' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(endpoints.admin.deleteReport).toHaveBeenCalledWith('s1');
    expect(await screen.findByText('Rival has not reported any Warden yet.')).toBeInTheDocument();
    expect(screen.getByText('2 reports')).toBeInTheDocument();
    expect(endpoints.admin.actions).toHaveBeenCalledTimes(2); // the history is reloaded
  });

  it('lets an admin make a player a moderator', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.grantModerator).mockResolvedValue({ ...players[0]!, is_moderator: true });
    renderPage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Make moderator' }));

    expect(endpoints.admin.grantModerator).toHaveBeenCalledWith(2);
    expect(await screen.findByText('Moderator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove moderator' })).toBeInTheDocument();
  });

  it('gives a moderator only the moderator tools, and none on staff accounts', async () => {
    const moderator: Player = { ...players[0]!, id: 3, email: 'mod@example.com', is_moderator: true };
    vi.mocked(endpoints.players).mockResolvedValue([...players, moderator]);
    renderPage(false);

    const manage = await screen.findAllByRole('button', { name: 'Manage' });
    await userEvent.click(manage[0]!);
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument();
    for (const adminOnly of ['Make moderator', 'Unlink Discord', 'Reset password', 'Delete account']) {
      expect(screen.queryByRole('button', { name: adminOnly })).not.toBeInTheDocument();
    }
    await userEvent.click(manage[0]!);

    for (const staff of [manage[1]!, manage[2]!]) {
      await userEvent.click(staff);
      expect(screen.getByText('Only admins can change admin and moderator accounts.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
      await userEvent.click(staff);
    }
  });
});
