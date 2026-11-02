/**
 * Docker only marks an unhealthy container, it does not restart it. When the bot has
 * been cut off from Discord or RabbitMQ for `graceMs` (their own reconnects gave up),
 * `onStuck` runs: the bot reports it and exits, and `restart: unless-stopped` brings a
 * fresh one up.
 */
export class Watchdog {
  private unhealthySince: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private fired = false;

  constructor(
    private readonly isHealthy: () => boolean,
    private readonly onStuck: (downForMs: number) => void,
    private readonly graceMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => this.check(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  check(): void {
    if (this.fired) return;
    if (this.isHealthy()) {
      this.unhealthySince = null;
      return;
    }
    this.unhealthySince ??= this.now();
    const downFor = this.now() - this.unhealthySince;
    if (downFor >= this.graceMs) {
      this.fired = true;
      this.onStuck(downFor);
    }
  }
}
