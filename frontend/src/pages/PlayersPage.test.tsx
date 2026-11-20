import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { Player } from '../api/types';
import { ToastProvider } from '../components/Toast';
import PlayersPage from './PlayersPage';

// Tested on its own (DuelReviewSection.test.tsx).
vi.mock('../components/DuelReviewSection', () => ({ default: () => null }));
vi.mock('../components/DeadClicksSection', () => ({ default: () => null }));

vi.mock('../api/endpoints', () => ({
  endpoints: {
    players: vi.fn(),
    worlds: vi.fn(),
    admin: { block: vi.fn(), unblock: vi.fn(), unlinkDiscord: vi.fn(), deleteUser: vi.fn(), addCharacter: vi.fn(), deleteCharacter: vi.fn(), resetPassword: vi.fn(), reports: vi.fn(), deleteReport: vi.fn(), grantModerator: vi.fn(), revokeModerator: vi.fn(), actions: vi.fn(), alertChannels: vi.fn(), setAlertChannel: vi.fn(), resetAlertChannel: vi.fn(), duels: vi.fn(), duelDetails: vi.fn(), flags: vi.fn() },
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
    characters: [], reports: 0, unconfirmed_reports: 0, reports_flagged: false, last_report_at: null, bestiary_marks: 0,
  },
  {
    id: 1, email: null, discord_username: 'Rival', discord_linked: true, is_admin: true, is_moderator: false, blocked: false, created_at: '2026-10-29T08:00:00Z',
    characters: [{ id: 'c9', name: 'Old Druid', server_name: 'Secura' }], reports: 3, unconfirmed_reports: 0, reports_flagged: false, last_report_at: '2026-10-30T07:00:00Z', bestiary_marks: 412,
  },
];

describe('PlayersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); // which sections are open is remembered
    vi.mocked(endpoints.admin.flags).mockResolvedValue({ days: 30, dead_click_pairs: 0, duel_pairs: 0 });
    vi.mocked(endpoints.worlds).mockResolvedValue(['Monza', 'Secura']);
    vi.mocked(endpoints.admin.actions).mockResolvedValue([]);
    vi.mocked(endpoints.admin.duels).mockResolvedValue({ from: '', until: '', truncated: false, duels: [], pairs: [] });
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
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('  Fake reports  ');
    renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Block' }));
    expect(endpoints.admin.block).not.toHaveBeenCalled(); // cancelled
    await user.click(screen.getByRole('button', { name: 'Block' }));

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(endpoints.admin.block).toHaveBeenCalledWith(2, 'Fake reports');
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
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Duplicate account');
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(endpoints.admin.deleteUser).toHaveBeenCalledWith(2, 'Duplicate account');
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
      { id: 2, admin: 'Rival', player: 'spam@example.com', action: 'block', details: null, reason: 'Fake reports', created_at: '2026-11-02T09:00:00Z' },
      { id: 1, admin: 'Rival', player: 'lukasz@example.com', action: 'add_character', details: 'New Knight (Monza)', reason: null, created_at: '2026-11-02T08:00:00Z' },
    ]);
    renderPage();

    const history = await screen.findByRole('region', { name: 'Admin history' });
    expect(within(history).queryByRole('listitem')).not.toBeInTheDocument(); // closed at first
    await userEvent.click(within(history).getByRole('button', { name: 'Admin history' }));
    const items = within(history).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Rival blocked spam@example.comReason: Fake reports');
    expect(items[1]).toHaveTextContent('Rival added a character to lukasz@example.com: New Knight (Monza)');
  });

  it('opens and closes sections, remembering the choice', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    const { unmount } = renderPage();

    const accounts = await screen.findByRole('button', { name: 'Accounts' });
    expect(accounts).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(accounts);
    expect(accounts).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Registered players' })).not.toBeInTheDocument();
    const duels = screen.getByRole('button', { name: 'Duels' });
    expect(duels).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(duels);

    unmount();
    renderPage();
    expect(await screen.findByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Duels' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('sums up what needs a look and opens the details', async () => {
    const user = userEvent.setup();
    const flagged = { ...players[0]!, id: 5, email: 'faker@example.com', reports: 6, unconfirmed_reports: 5, reports_flagged: true };
    vi.mocked(endpoints.players).mockResolvedValue([...players, flagged]);
    vi.mocked(endpoints.admin.flags).mockResolvedValue({ days: 30, dead_click_pairs: 2, duel_pairs: 0 });
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Needs a look' });
    expect(within(summary).getByRole('button', { name: '2 flagged Dead click pairs' })).toBeInTheDocument();
    expect(within(summary).queryByRole('button', { name: /duel pair/ })).not.toBeInTheDocument();

    await user.click(within(summary).getByRole('button', { name: '1 player with many unconfirmed reports' }));
    const rows = within(screen.getByRole('region', { name: 'Registered players' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('faker@example.com');
    await user.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(within(screen.getByRole('region', { name: 'Registered players' })).getAllByRole('listitem')).toHaveLength(3);

    // A closed section opens when its flag is clicked.
    expect(screen.getByRole('button', { name: 'Dead clicks' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(summary).getByRole('button', { name: '2 flagged Dead click pairs' }));
    expect(screen.getByRole('button', { name: 'Dead clicks' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says when nothing is flagged', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.flags).mockResolvedValue({ days: 30, dead_click_pairs: 0, duel_pairs: 0 });
    renderPage();
    expect(await screen.findByText(/Nothing flagged/)).toBeInTheDocument();
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
      unconfirmed: 2,
      flagged: false,
      worlds: [{ server_name: 'Secura', reports: 3 }],
      monsters: [{ name: 'Dragon Warden', image_url: null, reports: 2 }, { name: 'Hydra Warden', image_url: null, reports: 1 }],
      recent: [
        { id: 's1', monster: 'Dragon Warden', image_url: null, server_name: 'Secura', location: 'Darashia dragons', city: 'Darashia', status: 'KILLED', created_at: '2026-11-02T07:00:00Z' },
      ],
    });
    renderPage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reports' }))[1]!);

    expect(endpoints.admin.reports).toHaveBeenCalledWith(1, {});
    const panel = await screen.findByRole('region', { name: 'Reports of Rival' });
    expect(within(panel).getByText('All time').nextSibling).toHaveTextContent('3');
    expect(within(panel).getByText('Killed', { selector: 'dt' }).nextSibling).toHaveTextContent('1');
    expect(within(panel).getByText('Unconfirmed', { selector: 'dt' }).nextSibling).toHaveTextContent('2');
    expect(within(panel).queryByText(/were never confirmed/)).not.toBeInTheDocument();
    expect(within(panel).getByText('Hydra Warden')).toBeInTheDocument();
    expect(within(panel).getByText('Darashia dragons')).toBeInTheDocument();
    expect(within(panel).getByText('Newest 1 reports')).toBeInTheDocument();

    // A date window: both days count in full, the totals are labelled for it.
    fireEvent.change(within(panel).getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(within(panel).getByLabelText('To'), { target: { value: '2026-10-31' } });
    expect(endpoints.admin.reports).toHaveBeenLastCalledWith(1, { from: new Date(2026, 9, 1).toISOString(), until: new Date(2026, 10, 1).toISOString() });
    expect(await within(panel).findByText('In these dates')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'All time' }));
    expect(endpoints.admin.reports).toHaveBeenLastCalledWith(1, {});
  });

  it('flags a player whose reports nobody confirms', async () => {
    vi.mocked(endpoints.players).mockResolvedValue([{ ...players[0]!, reports: 6, unconfirmed_reports: 5, reports_flagged: true }]);
    vi.mocked(endpoints.admin.reports).mockResolvedValue({
      total: 6, last_7_days: 6, last_30_days: 6, first_report_at: '2026-11-01T07:00:00Z', last_report_at: '2026-11-02T07:00:00Z',
      by_status: { active: 0, killed: 0, expired: 6 }, unconfirmed: 5, flagged: true, worlds: [], monsters: [], recent: [],
    });
    renderPage();

    expect(await screen.findByText('Unconfirmed reports')).toBeInTheDocument();
    expect(screen.getByText('5 unconfirmed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(await screen.findByText(/were never confirmed/)).toBeInTheDocument();
  });

  it('says so when a player has not reported anything', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    vi.mocked(endpoints.admin.reports).mockResolvedValue({
      total: 0, last_7_days: 0, last_30_days: 0, first_report_at: null, last_report_at: null,
      by_status: { active: 0, killed: 0, expired: 0 }, unconfirmed: 0, flagged: false, worlds: [], monsters: [], recent: [],
    });
    renderPage();

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reports' }))[0]!);

    expect(await screen.findByText('lukasz@example.com has not reported any Warden yet.')).toBeInTheDocument();
  });

  it('deletes a report after confirming and refreshes the counts', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Made up');
    vi.mocked(endpoints.players).mockResolvedValue(players);
    const stats = {
      total: 1, last_7_days: 1, last_30_days: 1, first_report_at: '2026-11-02T07:00:00Z', last_report_at: '2026-11-02T07:00:00Z',
      by_status: { active: 1, killed: 0, expired: 0 }, unconfirmed: 0, flagged: false, worlds: [{ server_name: 'Secura', reports: 1 }],
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

    expect(window.prompt).toHaveBeenCalled();
    expect(endpoints.admin.deleteReport).toHaveBeenCalledWith('s1', 'Made up');
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
