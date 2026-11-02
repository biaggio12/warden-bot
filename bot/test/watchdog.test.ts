import { describe, expect, it, vi } from 'vitest';
import { Watchdog } from '../src/watchdog.js';

describe('Watchdog', () => {
  it('fires once the bot has been unhealthy for the whole grace period', () => {
    let now = 0;
    let healthy = false;
    const onStuck = vi.fn();
    const dog = new Watchdog(() => healthy, onStuck, 300_000, () => now);

    dog.check();
    now = 299_999;
    dog.check();
    expect(onStuck).not.toHaveBeenCalled();

    now = 300_000;
    dog.check();
    expect(onStuck).toHaveBeenCalledWith(300_000);
    now = 400_000;
    dog.check();
    expect(onStuck).toHaveBeenCalledOnce();
  });

  it('starts over when the bot recovers in between', () => {
    let now = 0;
    let healthy = false;
    const onStuck = vi.fn();
    const dog = new Watchdog(() => healthy, onStuck, 300_000, () => now);

    dog.check();
    now = 200_000;
    healthy = true;
    dog.check();
    healthy = false;
    now = 250_000;
    dog.check();
    now = 500_000;
    dog.check();
    expect(onStuck).not.toHaveBeenCalled();
    now = 550_000;
    dog.check();
    expect(onStuck).toHaveBeenCalledOnce();
  });
});
