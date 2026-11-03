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
    killSpawn: vi.fn(),
    discordGuilds: vi.fn(),
    me: vi.fn(),
    discordConfig: vi.fn(),
    discordLinkCode: vi.fn(),
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
    mocked.me.mockResolvedValue({ id: 1, email: null, display_name: 'lukasz', discord_linked: true, discord_username: 'lukasz' });
    mocked.discordConfig.mockResolvedValue({ enabled: true, authorize_url: 'https://discord.com/oauth2/authorize?client_id=1' });
    mocked.discordGuilds.mockResolvedValue([]);
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
      discord_guild_id: null,
    });
    expect(screen.queryByRole('combobox', { name: 'Discord server' })).not.toBeInTheDocument();
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

  it('sends the alert to one chosen Discord server only', async () => {
    const user = userEvent.setup();
    mocked.discordGuilds.mockResolvedValue([
      { id: '100000000000000001', name: 'Alpha' },
      { id: '100000000000000002', name: 'Beta' },
    ]);
    mocked.reportSpawn.mockResolvedValue({
      id: 's1', monster: { id: 7, name: 'Hydra' }, server_name: 'Monza', city: 'Thais', location_description: 'Hydra cave',
      additional_info: null, status: 'ACTIVE', created_at: '2026-10-29T12:00:00Z', expires_at: '2026-10-29T12:07:00Z',
    });
    renderPage();

    await user.type(await screen.findByPlaceholderText(/Start typing/), 'Hydra');
    await user.selectOptions(screen.getByRole('combobox', { name: 'City' }), 'Thais');
    await user.type(screen.getByRole('textbox', { name: 'Spot' }), 'Hydra cave');
    const picker = await screen.findByRole('combobox', { name: 'Discord server' });
    expect(picker).toHaveValue('');
    await user.selectOptions(picker, 'Only Beta');
    await user.click(screen.getByRole('button', { name: 'Report' }));

    expect(mocked.discordGuilds).toHaveBeenCalledWith('Monza');
    expect(mocked.reportSpawn).toHaveBeenCalledWith(expect.objectContaining({ discord_guild_id: '100000000000000002' }));
  });

  it('asks an account without Discord to link it instead of showing the form', async () => {
    const user = userEvent.setup();
    mocked.me.mockResolvedValue({ id: 1, email: 'player@example.com', display_name: 'player@example.com', discord_linked: false, discord_username: null });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Link Discord to report Wardens' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Link with Discord' })).toBeInTheDocument();

    // Linked in the meantime (e.g. /link on Discord): checking shows the form.
    mocked.discordLinkCode.mockResolvedValue({ code: 'ABCD2345', expires_at: '2026-11-02T12:10:00Z' });
    await user.click(screen.getByRole('button', { name: 'Generate a /link code' }));
    mocked.me.mockResolvedValue({ id: 1, email: 'player@example.com', display_name: 'player@example.com', discord_linked: true, discord_username: 'lukasz' });
    await user.click(await screen.findByRole('button', { name: 'Check connection' }));
    expect(await screen.findByRole('button', { name: 'Report' })).toBeInTheDocument();
  });

  it('asks before reporting a Warden that is already reported, and reports it when confirmed', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    mocked.activeSpawns.mockResolvedValue([{
      id: 's9', monster: { id: 7, name: 'Hydra' }, server_name: 'Monza', city: 'Thais', location_description: 'Hydra cave',
      additional_info: null, status: 'ACTIVE' as const, reported_by: { characters: ['Someone'], discord_name: null }, is_yours: false,
      created_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 5 * 60_000).toISOString(),
    }]);
    mocked.reportSpawn.mockResolvedValue({
      id: 's1', monster: { id: 7, name: 'Hydra' }, server_name: 'Monza', city: 'Venore', location_description: 'Other cave',
      additional_info: null, status: 'ACTIVE', created_at: '2026-10-29T12:00:00Z', expires_at: '2026-10-29T12:07:00Z',
    });
    renderPage();
    await screen.findByText('Someone');

    await user.type(screen.getByPlaceholderText(/Start typing/), 'Hydra');
    await user.click(await screen.findByRole('option', { name: /Hydra/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'City' }), 'Venore');
    await user.type(screen.getByRole('textbox', { name: 'Spot' }), 'Other cave');
    await user.click(screen.getByRole('button', { name: 'Report' }));

    expect(mocked.reportSpawn).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Hydra is already reported on Monza: Thais, Hydra cave');
    await user.click(screen.getByRole('button', { name: 'It is another one, report it' }));
    expect(mocked.reportSpawn).toHaveBeenCalledWith(expect.objectContaining({ monster_id: 7, location_description: 'Other cave' }));
  });

  it('defaults the TTL to 8 minutes', async () => {
    renderPage();
    expect(await screen.findByRole('radio', { name: '8 min' })).toBeChecked();
  });

  it('offers [Gone] only on your own reports', async () => {
    const now = Date.now();
    mocked.activeSpawns.mockResolvedValue([{
      id: 's2', monster: { id: 7, name: 'Hydra' }, server_name: 'Monza', city: null, location_description: 'Hydra cave',
      additional_info: null, status: 'ACTIVE' as const, reported_by: { characters: ['Someone'], discord_name: null }, is_yours: false,
      created_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 5 * 60_000).toISOString(),
    }]);
    renderPage();

    expect(await screen.findByText('Someone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gone? Remove report' })).not.toBeInTheDocument();
  });

  it('says which of your characters still need the Warden', async () => {
    const now = Date.now();
    const base = {
      monster: { id: 7, name: 'Hydra' }, server_name: 'Monza', city: null, location_description: 'Hydra cave',
      additional_info: null, status: 'ACTIVE' as const, reported_by: { characters: ['Someone'], discord_name: null }, is_yours: false,
      created_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 5 * 60_000).toISOString(),
    };
    mocked.activeSpawns.mockResolvedValue([
      { ...base, id: 's1', your_characters: { missing: ['Knight Two'], done: ['Knight One'] } },
      { ...base, id: 's2', your_characters: { missing: [], done: ['Knight One', 'Knight Two'] } },
    ]);
    renderPage();

    expect(await screen.findByText('Knight Two')).toHaveClass('text-xp');
    expect(screen.getByText(/has it: Knight One/)).toBeInTheDocument();
    expect(screen.getByText('All your characters have it already.')).toBeInTheDocument();
  });

  it('closes a report early after a second click', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const spawn = {
      id: 's1', monster: { id: 7, name: 'Hydra' }, server_name: 'Monza', city: 'Thais', location_description: 'Hydra cave',
      additional_info: null, status: 'ACTIVE' as const, reported_by: { characters: ['Sir Tester'], discord_name: 'lukasz' }, is_yours: true,
      created_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 5 * 60_000).toISOString(),
    };
    mocked.activeSpawns.mockResolvedValue([spawn]);
    mocked.killSpawn.mockResolvedValue({ ...spawn, status: 'KILLED' });
    renderPage();

    expect(await screen.findByText('Sir Tester (lukasz)')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Gone? Remove report' }));
    expect(mocked.killSpawn).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));

    expect(mocked.killSpawn).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.getByText('No active reports.')).toBeInTheDocument());
  });
});
