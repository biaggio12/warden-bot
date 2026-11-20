import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import DeadClicksSection from './DeadClicksSection';

vi.mock('../api/endpoints', () => ({ endpoints: { admin: { deadClicks: vi.fn() } } }));

describe('DeadClicksSection', () => {
  beforeEach(() => {
    vi.mocked(endpoints.admin.deadClicks).mockReset().mockResolvedValue({
      from: '2026-10-21T00:00:00Z',
      until: '2026-11-21T00:00:00Z',
      pairs: [
        {
          closer: { id: 2, name: 'Helper' },
          reporter: { id: 1, name: 'Farmer' },
          closures: 6,
          quick: 5,
          median_minutes: 1.2,
          share: 0.86,
          last_at: '2026-11-19T20:16:00Z',
          flags: ['frequent', 'quick', 'one_closer'],
        },
        {
          closer: { id: 3, name: 'Stranger' },
          reporter: { id: 1, name: 'Farmer' },
          closures: 1,
          quick: 0,
          median_minutes: 6,
          share: 0.14,
          last_at: '2026-11-18T10:00:00Z',
          flags: [],
        },
      ],
    });
  });

  it('lists who closed whose reports, flagging the suspicious pairs', async () => {
    render(<DeadClicksSection players={[{ id: 1, name: 'Farmer' }, { id: 2, name: 'Helper' }]} />);

    const pairs = within(await screen.findByRole('list', { name: 'Dead click pairs' })).getAllByRole('listitem');
    expect(pairs[0]).toHaveTextContent('Helper closed reports of Farmer × 6');
    expect(pairs[0]).toHaveTextContent('5+ closures');
    expect(pairs[0]).toHaveTextContent('mostly within 2 min');
    expect(pairs[0]).toHaveTextContent('closes most of their reports');
    expect(pairs[0]).toHaveTextContent('5 within 2 min · typically 1.2 min after the report · 86% of their reports closed by others');
    expect(pairs[1]).not.toHaveTextContent('5+ closures');
  });

  it('asks again for the dates and the player picked', async () => {
    const user = userEvent.setup();
    render(<DeadClicksSection players={[{ id: 1, name: 'Farmer' }, { id: 2, name: 'Helper' }]} />);
    await screen.findByRole('list', { name: 'Dead click pairs' });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Player' }), 'Helper');

    expect(endpoints.admin.deadClicks).toHaveBeenLastCalledWith({
      from: new Date(2026, 10, 1).toISOString(),
      until: new Date(2026, 10, 11).toISOString(),
      userId: 2,
    });
  });

  it('says so when nobody closed anyone else’s report', async () => {
    vi.mocked(endpoints.admin.deadClicks).mockResolvedValue({ from: '', until: '', pairs: [] });
    render(<DeadClicksSection />);
    expect(await screen.findByText(/Nobody closed someone else/)).toBeInTheDocument();
  });
});
