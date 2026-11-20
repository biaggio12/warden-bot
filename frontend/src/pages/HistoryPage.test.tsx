import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { HistoryEntry } from '../api/types';
import HistoryPage from './HistoryPage';

vi.mock('../api/endpoints', () => ({ endpoints: { history: vi.fn(), worlds: vi.fn(), monsters: vi.fn(), reporters: vi.fn() } }));
const mocked = vi.mocked(endpoints);

const entry = (id: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  monster: { id: 7, name: 'Hydra' },
  server_name: 'Monza',
  city: 'Thais',
  location_description: 'Hydra cave',
  reported_by: { characters: ['Sir Tester'], discord_name: 'lukasz' },
  status: 'KILLED',
  responded: 3,
  created_at: '2026-11-03T09:00:00Z',
  expires_at: '2026-11-03T09:08:00Z',
  ...overrides,
});

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.worlds.mockResolvedValue(['Antica', 'Monza']);
    mocked.monsters.mockResolvedValue([]);
    mocked.reporters.mockResolvedValue([{ id: 4, name: 'lukasz' }, { id: 9, name: 'Rival' }]);
  });

  it('lists past reports and loads older ones', async () => {
    const user = userEvent.setup();
    mocked.history
      .mockResolvedValueOnce({ warden_spawns: [entry('a')], next_before: 'a' })
      .mockResolvedValueOnce({ warden_spawns: [entry('b', { monster: { id: 8, name: 'Dragon' }, status: 'EXPIRED', responded: 0, reported_by: { characters: [], discord_name: null } })], next_before: null });
    render(<HistoryPage />);

    expect(await screen.findByText('Hydra')).toBeInTheDocument();
    expect(screen.getByText('Sir Tester (lukasz)')).toBeInTheDocument();
    expect(screen.getByText(/3 players went/)).toBeInTheDocument();
    expect(screen.getByText('Killed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show older' }));

    expect(await screen.findByText('Dragon')).toBeInTheDocument();
    expect(screen.getByText('a deleted account')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(mocked.history).toHaveBeenLastCalledWith({ serverName: undefined, monsterId: undefined, reporterId: undefined, before: 'a' });
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });

  it('filters by world', async () => {
    const user = userEvent.setup();
    mocked.history.mockResolvedValue({ warden_spawns: [], next_before: null });
    render(<HistoryPage />);
    await screen.findByText('No reports yet.');

    await user.selectOptions(await screen.findByRole('combobox', { name: 'World' }), 'Antica');

    expect(await screen.findByText('No reports on Antica yet.')).toBeInTheDocument();
    expect(mocked.history).toHaveBeenLastCalledWith({ serverName: 'Antica', monsterId: undefined, reporterId: undefined, before: undefined });
  });

  it('filters by reporter and dates, both days included', async () => {
    const user = userEvent.setup();
    mocked.history.mockResolvedValue({ warden_spawns: [], next_before: null });
    render(<HistoryPage />);
    await screen.findByText('No reports yet.');

    const reporter = screen.getByRole('combobox', { name: 'Reported by' });
    await screen.findByRole('option', { name: 'Rival' });
    await user.selectOptions(reporter, 'Rival');
    expect(await screen.findByText('No reports by Rival yet.')).toBeInTheDocument();
    expect(mocked.history).toHaveBeenLastCalledWith({ serverName: undefined, monsterId: undefined, reporterId: 9, before: undefined });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-03' } });
    expect(await screen.findByText('No reports by Rival in these dates.')).toBeInTheDocument();
    expect(mocked.history).toHaveBeenLastCalledWith({
      serverName: undefined,
      monsterId: undefined,
      reporterId: 9,
      from: new Date(2026, 10, 1).toISOString(),
      until: new Date(2026, 10, 4).toISOString(),
      before: undefined,
    });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-05' } });
    expect(await screen.findByText('Pick a start date on or before the end date.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('No reports yet.')).toBeInTheDocument();
    expect(mocked.history).toHaveBeenLastCalledWith({ serverName: undefined, monsterId: undefined, reporterId: undefined, before: undefined });
  });
});
