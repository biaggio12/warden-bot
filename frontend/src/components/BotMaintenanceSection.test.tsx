import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import BotMaintenanceSection from './BotMaintenanceSection';
import { ToastProvider } from './Toast';

vi.mock('../api/endpoints', () => ({
  endpoints: { admin: { botMaintenance: vi.fn(), botBackOnline: vi.fn() } },
}));

const renderSection = (onPosted = vi.fn()) => {
  render(
    <ToastProvider>
      <BotMaintenanceSection onPosted={onPosted} />
    </ToastProvider>,
  );
  return onPosted;
};

describe('BotMaintenanceSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks first, then sends the time and the note', async () => {
    vi.mocked(endpoints.admin.botMaintenance).mockResolvedValue({ back_at: '2026-11-19T20:15:00Z' });
    const onPosted = renderSection();

    await userEvent.clear(screen.getByLabelText('Back in (minutes)'));
    await userEvent.type(screen.getByLabelText('Back in (minutes)'), '20');
    await userEvent.type(screen.getByLabelText('Note for the players (optional)'), ' New sensitivities ');
    await userEvent.click(screen.getByRole('button', { name: 'Post "bot down"' }));

    expect(endpoints.admin.botMaintenance).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, post it' }));

    expect(endpoints.admin.botMaintenance).toHaveBeenCalledWith(20, 'New sensitivities');
    expect(await screen.findByText(/Maintenance notice sent/)).toBeInTheDocument();
    expect(onPosted).toHaveBeenCalled();
  });

  it('sends no time when the field is empty, and can be cancelled', async () => {
    vi.mocked(endpoints.admin.botMaintenance).mockResolvedValue({ back_at: null });
    renderSection();

    await userEvent.clear(screen.getByLabelText('Back in (minutes)'));
    await userEvent.click(screen.getByRole('button', { name: 'Post "bot down"' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Post "bot down"' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Post "bot down"' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, post it' }));

    expect(endpoints.admin.botMaintenance).toHaveBeenCalledWith(null, null);
  });

  it('posts that the bot is back, with the note', async () => {
    vi.mocked(endpoints.admin.botBackOnline).mockResolvedValue([]);
    const onPosted = renderSection();

    await userEvent.type(screen.getByLabelText('Note for the players (optional)'), 'New sensitivities');
    await userEvent.click(screen.getByRole('button', { name: 'Post "bot is back"' }));
    expect(screen.getByText('Post "bot is back" in every alert channel now?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, post it' }));

    expect(endpoints.admin.botBackOnline).toHaveBeenCalledWith('New sensitivities');
    expect(endpoints.admin.botMaintenance).not.toHaveBeenCalled();
    expect(await screen.findByText(/"Bot is back" notice sent/)).toBeInTheDocument();
    expect(onPosted).toHaveBeenCalled();
  });
});
