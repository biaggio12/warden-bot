import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import ChangePasswordForm from './ChangePasswordForm';
import { ToastProvider } from './Toast';

vi.mock('../api/endpoints', () => ({ endpoints: { changePassword: vi.fn() } }));

const renderForm = () =>
  render(
    <ToastProvider>
      <ChangePasswordForm />
    </ToastProvider>,
  );

describe('ChangePasswordForm', () => {
  it('changes the password', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.changePassword).mockResolvedValue(undefined);
    renderForm();

    await user.type(screen.getByLabelText('Current password'), 'abcDEF234xyz');
    await user.type(screen.getByLabelText('New password'), 'my-new-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(endpoints.changePassword).toHaveBeenCalledWith('abcDEF234xyz', 'my-new-secret');
    expect(await screen.findByText('Password changed. Your other sessions were logged out.')).toBeInTheDocument();
  });

  it('shows a wrong current password next to the field', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.changePassword).mockRejectedValue(
      new ApiError(422, { title: 'x', status: 422, violations: [{ property_path: 'current_password', title: 'This is not your current password.' }] }),
    );
    renderForm();

    await user.type(screen.getByLabelText('Current password'), 'wrong-one');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('At least 8 characters.')).toBeInTheDocument();
    expect(endpoints.changePassword).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('New password'), '-but-long-now');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('This is not your current password.')).toBeInTheDocument();
  });
});
