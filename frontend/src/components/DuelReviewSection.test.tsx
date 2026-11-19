import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { AdminDuel } from '../api/types';
import DuelReviewSection from './DuelReviewSection';

vi.mock('../api/endpoints', () => ({ endpoints: { admin: { duels: vi.fn(), duelDetails: vi.fn() } } }));

const duel: AdminDuel = {
  id: 'd1',
  status: 'finished',
  minutes: 15,
  stake: 5,
  created_at: '2026-11-19T20:00:00Z',
  starts_at: '2026-11-19T20:01:00Z',
  ends_at: '2026-11-19T20:16:00Z',
  challenger: { id: 1, name: 'Farmer', score: 6 },
  opponent: { id: 2, name: 'Feeder', score: 0 },
  result: 'challenger',
};

describe('DuelReviewSection', () => {
  beforeEach(() => {
    vi.mocked(endpoints.admin.duels).mockResolvedValue({
      duels: [duel],
      pairs: [
        {
          a: { id: 1, name: 'Farmer' },
          b: { id: 2, name: 'Feeder' },
          duels: 3,
          a_wins: 3,
          b_wins: 0,
          draws: 0,
          stakes_to_a: 15,
          last_at: '2026-11-19T20:16:00Z',
          flags: ['repeated', 'one_sided'],
        },
      ],
    });
    vi.mocked(endpoints.admin.duelDetails).mockResolvedValue({
      duel,
      reports: [
        {
          id: 's1',
          reporter: { id: 1, name: 'Farmer' },
          monster: 'Dragon',
          server_name: 'Monza',
          status: 'expired',
          created_at: '2026-11-19T20:05:00Z',
          confirmations: [{ type: 'omw', user_id: 2, name: 'Feeder' }],
          confirmed_by_opponent_only: true,
          duplicate: false,
          counted: true,
          points: 6,
        },
      ],
    });
  });

  it('flags a pair that keeps meeting and shows where the points went', async () => {
    render(<DuelReviewSection />);

    const pairs = await screen.findByRole('list', { name: 'Duel pairs' });
    expect(pairs).toHaveTextContent('Farmer3 : 0Feeder');
    expect(within(pairs).getByText('3+ duels in 7 days')).toBeInTheDocument();
    expect(within(pairs).getByText('one side wins every staked duel')).toBeInTheDocument();
    expect(pairs).toHaveTextContent('15 point(s) went to Farmer');
  });

  it('opens a duel to show who confirmed each report', async () => {
    const user = userEvent.setup();
    render(<DuelReviewSection />);

    const duels = await screen.findByRole('list', { name: 'Latest duels' });
    expect(duels).toHaveTextContent('Farmer challenged Feeder');
    expect(duels).toHaveTextContent('5 point(s) at stake');
    expect(duels).toHaveTextContent('6 : 0 (Farmer won)');

    await user.click(within(duels).getByRole('button', { name: 'Reports' }));

    const reports = await screen.findByRole('list', { name: 'Reports during the duel' });
    expect(endpoints.admin.duelDetails).toHaveBeenCalledWith('d1');
    expect(reports).toHaveTextContent('Farmer: Dragon on Monza');
    expect(reports).toHaveTextContent('OMW by Feeder');
    expect(within(reports).getByText('only the opponent confirmed')).toBeInTheDocument();
    expect(reports).toHaveTextContent('+6');
  });
});
