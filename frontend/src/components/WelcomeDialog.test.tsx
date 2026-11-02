import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../api/endpoints';
import { ToastProvider } from './Toast';
import WelcomeDialog from './WelcomeDialog';

vi.mock('../api/endpoints', () => ({
  endpoints: {
    worlds: vi.fn(),
    createCharacter: vi.fn(),
    discordConfig: vi.fn(),
    discordLinkCode: vi.fn(),
  },
}));

const mocked = vi.mocked(endpoints);

function renderDialog(discordLinked: boolean) {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <WelcomeDialog discordLinked={discordLinked} onCheckDiscord={vi.fn()} onClose={onClose} />
    </ToastProvider>,
  );
  return { onClose };
}

async function addCharacter(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Character name' }), 'Sir Tester');
  await user.selectOptions(await screen.findByRole('combobox', { name: 'World' }), 'Monza');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByRole('list', { name: 'Added characters' });
}

describe('WelcomeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.worlds.mockResolvedValue(['Monza', 'Secura']);
    mocked.createCharacter.mockResolvedValue({ id: 'c1', name: 'Sir Tester', server_name: 'Monza' });
    mocked.discordConfig.mockResolvedValue({ enabled: true, authorize_url: 'https://discord.com/oauth2/authorize?client_id=1' });
    mocked.discordLinkCode.mockResolvedValue({ code: 'ABCD2345', expires_at: '2026-11-02T12:10:00Z' });
  });

  it('asks for a character first and only then lets the player go on', async () => {
    const user = userEvent.setup();
    renderDialog(true);

    expect(screen.getByRole('dialog', { name: 'Welcome! Add your characters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    await addCharacter(user);

    expect(mocked.createCharacter).toHaveBeenCalledWith('Sir Tester', 'Monza');
    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument();
  });

  it('a Discord account is done after the characters', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(true);

    await addCharacter(user);
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('an e-mail account is then shown how to link Discord', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(false);

    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    await addCharacter(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('dialog', { name: 'Link your Discord account' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Link with Discord' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate a /link code' }));
    expect(await screen.findByText('/link code:ABCD2345')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('can be put off with Later or Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(false);

    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(onClose).toHaveBeenCalledWith(false);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});
