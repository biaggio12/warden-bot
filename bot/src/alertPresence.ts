import type { APIEmbed, EmbedBuilder } from 'discord.js';
import { presenceOf, withPresence, type Presence } from './messages.js';

type Write = (embed: EmbedBuilder) => Promise<unknown>;

/** Where the full lists are kept (the backend): the alert itself names only the first few. */
export interface PresenceStore {
  load(spawnId: string, messageId: string): Promise<Presence>;
  save(spawnId: string, messageId: string, presence: Presence): Promise<void>;
}

/** The alert as it is identified everywhere: its report and its Discord message. */
export interface AlertRef {
  spawnId: string;
  messageId: string;
}

interface Entry {
  spawnId: string;
  embed: APIEmbed;
  /** The full lists, read from the store, before the first change is applied. */
  ready: Promise<void>;
  presence: Presence;
  /** The write that carries the latest change, waiting for the one in flight. */
  pending: Write | null;
  flushing: Promise<void> | null;
  closed: boolean;
  touchedAt: number;
}

/** Long past any alert's lifetime (10 minutes at most). */
const FORGET_AFTER_MS = 60 * 60_000;

/**
 * The live presence lists of the channel alerts. Every click comes with the message as
 * it was when it was clicked, so two players clicking at once would each write their
 * own copy and one of them would vanish. Instead the changes are applied here, one
 * after another, on top of the latest lists, and written one edit at a time: clicks
 * that arrive during an edit are folded into the next one, so a rush of 100 clicks
 * becomes a handful of edits. Every edit also saves the full lists in the store, so
 * players past the ones the alert names survive a restart of the bot.
 */
export class AlertPresence {
  private readonly alerts = new Map<string, Entry>();

  constructor(
    private readonly store: PresenceStore | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  /** The full latest lists of an alert. */
  async of(alert: AlertRef, embed: APIEmbed): Promise<Presence> {
    const entry = this.entryOf(alert, embed);
    await entry.ready;
    return entry.presence;
  }

  /**
   * Applies `change` on top of the latest lists and writes the result. Resolves once an
   * edit carrying this change is done (or failed, which is logged). Closed alerts are
   * left alone.
   */
  async change(alert: AlertRef, embed: APIEmbed, change: (presence: Presence) => Presence, write: Write): Promise<void> {
    this.forgetOld();
    const entry = this.entryOf(alert, embed);
    // Changes queue up behind the load in the order they came in.
    await entry.ready;
    if (entry.closed) {
      return Promise.resolve();
    }
    entry.presence = change(entry.presence);
    entry.pending = write;
    entry.touchedAt = this.now();
    entry.flushing ??= this.flush(alert.messageId, entry);
    return entry.flushing;
  }

  /**
   * The alert's lists: the store's when it has any, otherwise what the embed names (an
   * alert nobody clicked, or one from before the store, or the store is unreachable).
   */
  private entryOf({ spawnId, messageId }: AlertRef, embed: APIEmbed): Entry {
    let entry = this.alerts.get(messageId);
    if (!entry) {
      const created: Entry = { spawnId, embed, presence: presenceOf(embed), ready: Promise.resolve(), pending: null, flushing: null, closed: false, touchedAt: this.now() };
      created.ready = this.load(spawnId, messageId).then((stored) => {
        if (stored) created.presence = stored;
      });
      this.alerts.set(messageId, created);
      entry = created;
    }
    return entry;
  }

  private async load(spawnId: string, messageId: string): Promise<Presence | null> {
    if (!this.store) return null;
    try {
      const stored = await this.store.load(spawnId, messageId);
      return stored.onMyWay.length > 0 || stored.onSite.length > 0 ? stored : null;
    } catch (error) {
      console.warn(`[presence] Could not load the lists of alert ${messageId}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * The alert is being expired or marked dead: no more changes, and the edits still in
   * flight finish first, so none of them lands on top of the final message.
   * Returns the final lists: from memory, else from the store (an alert from before a
   * restart, when `spawnId` is given), or null when neither knows them.
   */
  async close(messageId: string, spawnId?: string): Promise<Presence | null> {
    const entry = this.alerts.get(messageId);
    if (!entry) {
      return spawnId ? this.load(spawnId, messageId) : null;
    }
    await entry.ready;
    entry.closed = true;
    entry.pending = null;
    await entry.flushing;
    return entry.presence;
  }

  private async flush(messageId: string, entry: Entry): Promise<void> {
    while (entry.pending) {
      const write = entry.pending;
      entry.pending = null;
      const presence = entry.presence;
      await Promise.all([
        write(withPresence(entry.embed, presence)).catch((error: Error) =>
          console.warn(`[presence] Could not update the lists of alert ${messageId}:`, error.message),
        ),
        this.store?.save(entry.spawnId, messageId, presence).catch((error: Error) =>
          console.warn(`[presence] Could not save the lists of alert ${messageId}:`, error.message),
        ),
      ]);
    }
    entry.flushing = null;
  }

  private forgetOld(): void {
    const cutoff = this.now() - FORGET_AFTER_MS;
    for (const [messageId, entry] of this.alerts) {
      if (entry.touchedAt < cutoff && !entry.flushing) {
        this.alerts.delete(messageId);
      }
    }
  }
}
