import type { APIEmbed, EmbedBuilder } from 'discord.js';
import { presenceOf, withPresence, type Presence } from './messages.js';

type Write = (embed: EmbedBuilder) => Promise<unknown>;

interface Entry {
  embed: APIEmbed;
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
 * becomes a handful of edits.
 */
export class AlertPresence {
  private readonly alerts = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The latest lists of an alert; for an alert nobody has touched yet, what its embed says. */
  of(messageId: string, embed: APIEmbed): Presence {
    return this.alerts.get(messageId)?.presence ?? presenceOf(embed);
  }

  /**
   * Applies `change` on top of the latest lists and writes the result. Resolves once an
   * edit carrying this change is done (or failed, which is logged). Closed alerts are
   * left alone.
   */
  change(messageId: string, embed: APIEmbed, change: (presence: Presence) => Presence, write: Write): Promise<void> {
    this.forgetOld();
    let entry = this.alerts.get(messageId);
    if (!entry) {
      entry = { embed, presence: presenceOf(embed), pending: null, flushing: null, closed: false, touchedAt: 0 };
      this.alerts.set(messageId, entry);
    }
    if (entry.closed) {
      return Promise.resolve();
    }
    entry.presence = change(entry.presence);
    entry.pending = write;
    entry.touchedAt = this.now();
    entry.flushing ??= this.flush(messageId, entry);
    return entry.flushing;
  }

  /**
   * The alert is being expired or marked dead: no more changes, and the edits still in
   * flight finish first, so none of them lands on top of the final message.
   * Returns the final lists, or null when the bot never changed them.
   */
  async close(messageId: string): Promise<Presence | null> {
    const entry = this.alerts.get(messageId);
    if (!entry) {
      return null;
    }
    entry.closed = true;
    entry.pending = null;
    await entry.flushing;
    return entry.presence;
  }

  private async flush(messageId: string, entry: Entry): Promise<void> {
    while (entry.pending) {
      const write = entry.pending;
      entry.pending = null;
      try {
        await write(withPresence(entry.embed, entry.presence));
      } catch (error) {
        console.warn(`[presence] Could not update the lists of alert ${messageId}:`, (error as Error).message);
      }
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
