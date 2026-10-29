import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { Stats } from '../api/types';
import StatsPage from './StatsPage';

vi.mock('../api/endpoints', () => ({ endpoints: { stats: vi.fn() } }));

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
  you: { reports: 4, rank: 2, reporters: 3, reports_all_time: 9, characters: [{ name: 'Demo Knight', server_name: 'Monza', killed: 83, total: 833 }] },
};

describe('StatsPage', () => {
  beforeEach(() => {
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
    expect(screen.getByText('83/833 · 10%')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('29 Oct8');
  });

  it('reloads for another period and remembers it', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await screen.findByText('#2');

    await user.click(screen.getByRole('radio', { name: '7 days' }));

    expect(endpoints.stats).toHaveBeenLastCalledWith('7d');
    expect(localStorage.getItem('warden-tracker.stats-period')).toBe('7d');
  });
});
