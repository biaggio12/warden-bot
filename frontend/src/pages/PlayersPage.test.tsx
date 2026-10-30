import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { Player } from '../api/types';
import PlayersPage from './PlayersPage';

vi.mock('../api/endpoints', () => ({ endpoints: { players: vi.fn() } }));

const players: Player[] = [
  {
    id: 2, email: 'lukasz@example.com', discord_username: null, discord_linked: false, created_at: '2026-10-30T08:00:00Z',
    characters: [], reports: 0, last_report_at: null, bestiary_marks: 0,
  },
  {
    id: 1, email: null, discord_username: 'Rival', discord_linked: true, created_at: '2026-10-29T08:00:00Z',
    characters: [{ name: 'Old Druid', server_name: 'Secura' }], reports: 3, last_report_at: '2026-10-30T07:00:00Z', bestiary_marks: 412,
  },
];

describe('PlayersPage', () => {
  it('lists every account with its Discord, characters and activity', async () => {
    vi.mocked(endpoints.players).mockResolvedValue(players);
    render(<PlayersPage />);

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
    render(<PlayersPage />);
    await screen.findByText('lukasz@example.com');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search players' }), 'druid');

    expect(screen.queryByText('lukasz@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Discord Rival')).toBeInTheDocument();
  });
});
