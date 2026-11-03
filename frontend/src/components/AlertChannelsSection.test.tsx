import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import type { AlertChannelSettings } from '../api/types';
import AlertChannelsSection from './AlertChannelsSection';
import { ToastProvider } from './Toast';

vi.mock('../api/endpoints', () => ({
  endpoints: { admin: { alertChannels: vi.fn(), setAlertChannel: vi.fn(), resetAlertChannel: vi.fn() } },
}));

const GUILD = '100000000000000001';

const settings = (assignments: AlertChannelSettings['assignments'] = []): AlertChannelSettings => ({
  enabled: true,
  prefix: 'wardens-',
  worlds: ['Monza', 'Secura', 'Zuna'],
  servers: [
    {
      id: GUILD,
      name: 'Echo Raid',
      channels: [
        { id: '201', name: 'general', category: null },
        { id: '202', name: 'wardens-monza', category: 'Wardens' },
        { id: '203', name: 'secura-alerts', category: 'Wardens' },
      ],
    },
  ],
  assignments,
});

const renderSection = () =>
  render(
    <ToastProvider>
      <AlertChannelsSection />
    </ToastProvider>,
  );

describe('AlertChannelsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists worlds with a named or chosen channel per server', async () => {
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue(settings([{ guild_id: GUILD, server_name: 'Secura', channel_id: '203' }]));
    renderSection();

    const server = await screen.findByRole('group', { name: 'Alert channels on Echo Raid' });
    expect(within(server).getByLabelText('Alert channel for Monza on Echo Raid')).toHaveValue('');
    expect(within(server).getByRole('option', { name: 'By name: #wardens-monza' })).toBeInTheDocument();
    expect(within(server).getByLabelText('Alert channel for Secura on Echo Raid')).toHaveValue('203');
    expect(within(server).queryByLabelText('Alert channel for Zuna on Echo Raid')).not.toBeInTheDocument();
  });

  it('chooses a channel by id for a world', async () => {
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue(settings());
    vi.mocked(endpoints.admin.setAlertChannel).mockResolvedValue(settings([{ guild_id: GUILD, server_name: 'Monza', channel_id: '201' }]));
    renderSection();

    await userEvent.selectOptions(await screen.findByLabelText('Alert channel for Monza on Echo Raid'), '201');

    expect(endpoints.admin.setAlertChannel).toHaveBeenCalledWith(GUILD, 'Monza', '201');
    expect(await screen.findByText('Monza alerts on Echo Raid now go to #general.')).toBeInTheDocument();
    expect(screen.getByLabelText('Alert channel for Monza on Echo Raid')).toHaveValue('201');
  });

  it('goes back to the named channel', async () => {
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue(settings([{ guild_id: GUILD, server_name: 'Monza', channel_id: '201' }]));
    vi.mocked(endpoints.admin.resetAlertChannel).mockResolvedValue(settings());
    renderSection();

    await userEvent.selectOptions(await screen.findByLabelText('Alert channel for Monza on Echo Raid'), '');

    expect(endpoints.admin.resetAlertChannel).toHaveBeenCalledWith(GUILD, 'Monza');
  });

  it('adds a world that has no channel yet', async () => {
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue(settings());
    vi.mocked(endpoints.admin.setAlertChannel).mockResolvedValue(settings([{ guild_id: GUILD, server_name: 'Zuna', channel_id: '201' }]));
    renderSection();

    await userEvent.selectOptions(await screen.findByLabelText('World to add on Echo Raid'), 'Zuna');
    await userEvent.selectOptions(screen.getByLabelText('Channel for the new world on Echo Raid'), '201');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(endpoints.admin.setAlertChannel).toHaveBeenCalledWith(GUILD, 'Zuna', '201');
    expect(await screen.findByLabelText('Alert channel for Zuna on Echo Raid')).toHaveValue('201');
  });

  it('warns when the chosen channel was deleted on Discord', async () => {
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue(settings([{ guild_id: GUILD, server_name: 'Zuna', channel_id: '999' }]));
    renderSection();

    expect(await screen.findByText(/The chosen channel no longer exists/)).toBeInTheDocument();
  });

  it('reads the channels from Discord again on request', async () => {
    vi.mocked(endpoints.admin.alertChannels).mockResolvedValue(settings());
    renderSection();
    await screen.findByRole('group', { name: 'Alert channels on Echo Raid' });

    await userEvent.click(screen.getByRole('button', { name: 'Reload channels' }));

    expect(endpoints.admin.alertChannels).toHaveBeenLastCalledWith(true);
  });
});
