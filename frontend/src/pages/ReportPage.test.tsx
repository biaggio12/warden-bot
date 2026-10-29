import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import { ToastProvider } from '../components/Toast';
import ReportPage from './ReportPage';

vi.mock('../api/endpoints', () => ({
  endpoints: {
    characters: vi.fn(),
    monsters: vi.fn(),
    cities: vi.fn(),
    activeSpawns: vi.fn(),
    reportSpawn: vi.fn(),
  },
}));

const mocked = vi.mocked(endpoints);

function renderPage() {
  return render(
    <ToastProvider>
      <ReportPage />
    </ToastProvider>,
  );
}

describe('ReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.characters.mockResolvedValue([{ id: 'c1', name: 'Sir Tester', server_name: 'Monza' }]);
    mocked.monsters.mockResolvedValue([
      { id: 142, name: 'Dragon Warden', category: 'Dragons', charm_points: 50, image_url: null },
      { id: 7, name: 'Hydra', category: 'Dragons', charm_points: 50, image_url: null },
    ]);
    mocked.cities.mockResolvedValue(['Thais', 'Venore']);
    mocked.activeSpawns.mockResolvedValue([]);
  });

  it('blocks submitting incomplete data', async () => {
    const user = userEvent.setup();
    renderPage();
    const submit = await screen.findByRole('button', { name: 'Report' });

    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Start typing/), 'Hydra');
    await user.type(screen.getByRole('textbox', { name: 'Spot' }), 'abc');
    expect(submit).toBeDisabled();

    await user.clear(screen.getByRole('textbox', { name: 'Spot' }));
    await user.type(screen.getByRole('textbox', { name: 'Spot' }), 'Dragon Lair -2');
    expect(submit).toBeDisabled(); // city still missing

    expect(mocked.reportSpawn).not.toHaveBeenCalled();
  });

  it('submits a complete report and shows the expiry toast', async () => {
    const user = userEvent.setup();
    mocked.reportSpawn.mockResolvedValue({
      id: 's1',
      monster: { id: 142, name: 'Dragon Warden' },
      server_name: 'Monza',
      city: 'Venore',
      location_description: 'Dragon Lair -2',
      additional_info: null,
      status: 'ACTIVE',
      created_at: '2026-10-29T12:00:00Z',
      expires_at: '2026-10-29T12:10:00Z',
    });
    renderPage();

    const combobox = await screen.findByPlaceholderText(/Start typing/);
    await waitFor(() => expect(screen.getByText('Monza')).toBeInTheDocument());
    await user.type(combobox, 'drag');
    await user.click(await screen.findByRole('option', { name: /Dragon Warden/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'City' }), 'Venore');
    await user.type(screen.getByRole('textbox', { name: 'Spot' }), 'Dragon Lair -2');
    await user.type(screen.getByRole('textbox', { name: 'Additional info' }), '  Wejście od wschodu  ');
    await user.click(screen.getByRole('radio', { name: '10 min' }));
    await user.click(screen.getByRole('button', { name: 'Report' }));

    expect(mocked.reportSpawn).toHaveBeenCalledWith({
      monster_id: 142,
      server_name: 'Monza',
      city: 'Venore',
      location_description: 'Dragon Lair -2',
      additional_info: 'Wejście od wschodu',
      ttl_minutes: 10,
    });
    const expected = new Date('2026-10-29T12:10:00Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    expect(await screen.findByText(`Reported successfully. Disappears at: ${expected}`)).toBeInTheDocument();
  });

  it('reports on the world where the player has the most characters', async () => {
    const user = userEvent.setup();
    mocked.characters.mockResolvedValue([
      { id: 'c1', name: 'A', server_name: 'Monza' },
      { id: 'c2', name: 'B', server_name: 'Secura' },
      { id: 'c3', name: 'C', server_name: 'Secura' },
    ]);
    mocked.reportSpawn.mockResolvedValue({
      id: 's1', monster: { id: 7, name: 'Hydra' }, server_name: 'Secura', city: 'Thais', location_description: 'Hydra cave',
      additional_info: null, status: 'ACTIVE', created_at: '2026-10-29T12:00:00Z', expires_at: '2026-10-29T12:07:00Z',
    });
    renderPage();

    await user.type(await screen.findByPlaceholderText(/Start typing/), 'Hydra');
    await user.selectOptions(screen.getByRole('combobox', { name: 'City' }), 'Thais');
    await user.type(screen.getByRole('textbox', { name: 'Spot' }), 'Hydra cave');
    await user.click(screen.getByRole('button', { name: 'Report' }));

    expect(mocked.reportSpawn).toHaveBeenCalledWith(expect.objectContaining({ server_name: 'Secura' }));
    expect(screen.queryByRole('combobox', { name: /world/i })).not.toBeInTheDocument();
  });

  it('defaults the TTL to 7 minutes', async () => {
    renderPage();
    expect(await screen.findByRole('radio', { name: '7 min' })).toBeChecked();
  });
});
