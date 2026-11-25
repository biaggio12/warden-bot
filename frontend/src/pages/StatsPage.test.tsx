import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { Stats } from '../api/types';
import StatsPage from './StatsPage';

vi.mock('../api/endpoints', () => ({ endpoints: { stats: vi.fn(), myReports: vi.fn() } }));

const stats: Stats = {
  period: '30d',
  totals: { reports: 12, reporters: 3, monsters: 5, active_now: 2 },
  reports_per_day: [
    { date: '2026-10-28', count: 4 },
    { date: '2026-10-29', count: 8 },
  ],
  top_monsters: [{ label: 'Dragon', count: 6 }],
  top_cities: [{ label: 'Venore', count: 5 }],
  leaderboard: [
    { rank: 1, player: 'Rival', reports: 7, is_you: false },
    { rank: 2, player: 'de…', reports: 4, is_you: true },
  ],
  points_leaderboard: [
    { rank: 1, player: 'de…', points: 3, is_you: true },
    { rank: 2, player: 'Rival', points: 1, is_you: false },
  ],
  bestiary_leaderboard: [
    { rank: 1, character: 'Old Druid', server_name: 'Secura', killed: 412, total: 833, is_you: false },
    { rank: 2, character: 'Demo Knight', server_name: 'Monza', killed: 83, total: 833, is_you: true },
  ],
  you: { reports: 4, rank: 2, reporters: 3, reports_all_time: 9, points: 3, points_rank: 1, characters: [{ name: 'Demo Knight', server_name: 'Monza', killed: 83, total: 833 }] },
};

describe('StatsPage', () => {
  beforeEach(() => {
    vi.mocked(endpoints.myReports).mockResolvedValue({
      period: '30d',
      points: 10,
      outcomes: { counted: 1, waiting: 0, unconfirmed: 1, duplicate: 0 },
      total: 2,
      reports: [
        { id: 'a', monster: 'Hard Warden', image_url: null, server_name: 'Monza', city: null, location: 'Cave', created_at: '2026-11-19T10:00:00Z', outcome: 'counted', points: 10 },
        { id: 'b', monster: 'Easy Warden', image_url: null, server_name: 'Monza', city: null, location: 'Hill', created_at: '2026-11-19T09:00:00Z', outcome: 'unconfirmed', points: 0 },
      ],
    });
    localStorage.clear();
    vi.mocked(endpoints.stats).mockResolvedValue(stats);
  });

  it('shows totals, the leaderboard with your row and your progress', async () => {
    render(<StatsPage />);

    expect(await screen.findByText('#2')).toBeInTheDocument();
    expect(screen.getByText('of 3')).toBeInTheDocument();
    const board = screen.getByRole('heading', { name: /Top reporters/ }).parentElement!;
    expect(within(board).getByText('Rival')).toBeInTheDocument();
    expect(within(board).getByText('you')).toBeInTheDocument();
    expect(screen.getByText('83/833, 10%')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('29 Oct8');
  });

  it('ranks characters by bestiary progress', async () => {
    render(<StatsPage />);

    const board = (await screen.findByRole('heading', { name: 'Bestiary leaders' })).closest('section')!;
    const rows = within(board).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Old Druid (Secura)412/833');
    expect(rows[1]).toHaveTextContent('you');
  });

  it('ranks players by points for confirmed reports', async () => {
    render(<StatsPage />);

    const board = (await screen.findByRole('heading', { name: 'Points' })).closest('section')!;
    expect(within(board).getByText(/You: 3 points \(#1\)/)).toBeInTheDocument();
    const rows = within(board).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('de…you3');
    expect(rows[1]).toHaveTextContent('Rival1');
  });

  it('reloads for another period and remembers it', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await screen.findByText('#2');

    await user.click(screen.getByRole('radio', { name: '7 days' }));

    expect(endpoints.stats).toHaveBeenLastCalledWith('7d');
    expect(localStorage.getItem('warden-tracker.stats-period')).toBe('7d');
  });

  it('explains which of my reports earned points and why', async () => {
    render(<StatsPage />);

    const section = await screen.findByRole('region', { name: 'Your reports and points' });
    expect(await within(section).findByText('10 points from 2 reports, 30 days. Duel stakes are not included.')).toBeInTheDocument();
    const rows = within(section).getAllByRole('listitem').filter((li) => li.closest('ol'));
    expect(rows[0]).toHaveTextContent('Hard Warden');
    expect(rows[0]).toHaveTextContent('Counted');
    expect(rows[0]).toHaveTextContent('+10');
    expect(rows[1]).toHaveTextContent('It ran out and nobody confirmed it.');
    expect(within(section).getByRole('list', { name: 'Reports by outcome' })).toHaveTextContent('Counted: 1Not confirmed: 1');
  });
});
