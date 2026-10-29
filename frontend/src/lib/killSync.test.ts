import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KillSync, type KillSyncState } from './killSync';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function setup(initial: number[] = []) {
  const states: KillSyncState[] = [];
  const save = vi.fn<(add: number[], remove: number[]) => Promise<number[]>>();
  const sync = new KillSync({ load: async () => initial, save }, (s) => states.push(s), 400);
  await sync.load();
  const last = () => states[states.length - 1]!;
  return { sync, save, last };
}

describe('KillSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies toggles optimistically and batches them into one request', async () => {
    const { sync, save, last } = await setup([1]);
    save.mockResolvedValue([2, 3, 4]);

    sync.set([2, 3], true);
    sync.set([4], true);
    sync.set([1], false);
    expect([...last().killed].sort()).toEqual([2, 3, 4]);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith([2, 3, 4], [1]);
    expect(last().status).toBe('saved');
  });

  it('skips the request when changes cancel out', async () => {
    const { sync, save } = await setup([1]);

    sync.set([1], false);
    sync.set([1], true);
    await vi.advanceTimersByTimeAsync(400);

    expect(save).not.toHaveBeenCalled();
  });

  it('keeps one request in flight and sends later changes afterwards', async () => {
    const { sync, save, last } = await setup();
    const first = deferred<number[]>();
    save.mockReturnValueOnce(first.promise).mockResolvedValueOnce([1, 2]);

    sync.set([1], true);
    await vi.advanceTimersByTimeAsync(400);
    sync.set([2], true);
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledOnce();
    expect([...last().killed].sort()).toEqual([1, 2]);

    first.resolve([1]);
    await vi.advanceTimersByTimeAsync(400);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith([2], []);
    expect([...last().killed].sort()).toEqual([1, 2]);
  });

  it('rolls back on a network error and can retry', async () => {
    const { sync, save, last } = await setup([1]);
    save.mockRejectedValueOnce(new Error('Brak połączenia z serwerem.')).mockResolvedValueOnce([1, 5]);

    sync.set([5], true);
    await vi.advanceTimersByTimeAsync(400);

    expect(last().status).toBe('error');
    expect(last().error).toBe('Brak połączenia z serwerem.');
    expect([...last().killed]).toEqual([1]);

    sync.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenLastCalledWith([5], []);
    expect([...last().killed].sort()).toEqual([1, 5]);
    expect(last().status).toBe('saved');
  });
});
