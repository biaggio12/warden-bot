import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeDiscordState, startDiscordAuth } from './discordAuth';

describe('Discord OAuth state', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('location', { assign: vi.fn() });
  });

  it('redirects with a random state and accepts it once on return', () => {
    startDiscordAuth('https://discord.com/oauth2/authorize?client_id=1', 'link');

    const url = vi.mocked(window.location.assign).mock.calls[0]![0] as string;
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();

    expect(consumeDiscordState(state)).toBe('link');
    expect(consumeDiscordState(state)).toBeNull();
  });

  it('rejects a callback whose state does not match', () => {
    startDiscordAuth('https://discord.com/oauth2/authorize?client_id=1', 'login');

    expect(consumeDiscordState('forged')).toBeNull();
  });
});
