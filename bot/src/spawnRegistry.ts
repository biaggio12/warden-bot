import type { WardenSpawned } from './events.js';

export interface SentMessage {
  channelId: string;
  messageId: string;
  /** Set for DMs, so the expired version keeps the per-player note. */
  note?: string;
}

/** Why an alert is retired: its time ran out, or a player reported the Warden dead. */
export type CloseReason = 'expired' | 'killed';

interface Entry {
  spawn: WardenSpawned;
  messages: SentMessage[];
  timer: NodeJS.Timeout | null;
  expired: boolean;
  /** Reported dead: the alert already shows it, expiry only removes it. */
  killed: boolean;
  /** Deleted by an admin: its messages are gone, nothing more to do. */
  deleted: boolean;
}

/**
 * In-memory index of alerts the bot has sent, so their buttons can be disabled when
 * the spawn expires (local timer at expires_at, or WardenExpiredEvent - whichever
 * comes first). Entries are dropped some time after expiry. After a restart, older
 * alerts are no longer tracked; their buttons still work but are not disabled.
 */
export class SpawnRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onExpire: (spawn: WardenSpawned, messages: SentMessage[], reason: CloseReason) => Promise<void>,
    private readonly retentionMs = 60 * 60_000,
  ) {}

  register(spawn: WardenSpawned): void {
    if (this.entries.has(spawn.spawn_id)) {
      return;
    }
    const delay = Math.max(0, new Date(spawn.expires_at).getTime() - Date.now());
    const timer = setTimeout(() => void this.expire(spawn.spawn_id), delay);
    timer.unref();
    this.entries.set(spawn.spawn_id, { spawn, messages: [], timer, expired: false, killed: false, deleted: false });
  }

  addMessage(spawnId: string, message: SentMessage): void {
    this.entries.get(spawnId)?.messages.push(message);
  }

  get(spawnId: string): WardenSpawned | null {
    return this.entries.get(spawnId)?.spawn ?? null;
  }

  messagesOf(spawnId: string): SentMessage[] {
    return this.entries.get(spawnId)?.messages ?? [];
  }

  /**
   * Flags a live spawn as killed. false when it is not tracked, already over or already
   * flagged (redelivered event), so the kill is announced once.
   */
  markKilled(spawnId: string): boolean {
    const entry = this.entries.get(spawnId);
    if (!entry || entry.expired || entry.killed) {
      return false;
    }
    entry.killed = true;
    return true;
  }

  /**
   * An admin deleted the report: stops its expiry and hands back its messages to delete,
   * once (null when not tracked or already deleted). Kept a while so a redelivered
   * warden.spawned is still recognised.
   */
  discard(spawnId: string): SentMessage[] | null {
    const entry = this.entries.get(spawnId);
    if (!entry || entry.deleted) {
      return null;
    }
    entry.deleted = true;
    if (!entry.expired) {
      entry.expired = true;
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      const cleanup = setTimeout(() => this.entries.delete(spawnId), this.retentionMs);
      cleanup.unref();
    }
    return entry.messages;
  }

  isExpired(spawnId: string): boolean {
    return this.entries.get(spawnId)?.expired ?? false;
  }

  /** Idempotent: the timer and the backend event may both trigger it. */
  async expire(spawnId: string): Promise<boolean> {
    const entry = this.entries.get(spawnId);
    if (!entry || entry.expired) {
      return false;
    }
    entry.expired = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    const cleanup = setTimeout(() => this.entries.delete(spawnId), this.retentionMs);
    cleanup.unref();

    await this.onExpire(entry.spawn, entry.messages, entry.killed ? 'killed' : 'expired');
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    this.entries.clear();
  }
}
