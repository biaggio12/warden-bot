import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpawnRegistry } from '../src/spawnRegistry.js';
import { spawnFixture } from './fixtures.js';

describe('SpawnRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('disables messages when the TTL passes', async () => {
    const onExpire = vi.fn().mockResolvedValue(undefined);
    const registry = new SpawnRegistry(onExpire);
    registry.register(spawnFixture());
    registry.addMessage('c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b', { channelId: 'c1', messageId: 'm1' });

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(onExpire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(onExpire.mock.calls[0]![1]).toEqual([{ channelId: 'c1', messageId: 'm1' }]);
  });

  it('expires only once when both the backend event and the timer fire', async () => {
    const onExpire = vi.fn().mockResolvedValue(undefined);
    const registry = new SpawnRegistry(onExpire);
    registry.register(spawnFixture());

    expect(await registry.expire('c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b')).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(onExpire).toHaveBeenCalledOnce();
    expect(registry.isExpired('c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b')).toBe(true);
  });

  it('ignores unknown spawns', async () => {
    const registry = new SpawnRegistry(vi.fn());
    expect(await registry.expire('unknown')).toBe(false);
  });
});
