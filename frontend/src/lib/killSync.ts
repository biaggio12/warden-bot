export type SyncStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

export interface KillSyncState {
  /** What the UI shows: server state with pending and in-flight changes applied. */
  killed: ReadonlySet<number>;
  status: SyncStatus;
  error: string | null;
}

export interface KillSyncBackend {
  load(): Promise<number[]>;
  /** One request for the whole batch; resolves with the server's full list afterwards. */
  save(add: number[], remove: number[]): Promise<number[]>;
}

/**
 * Optimistic bestiary state for one character.
 *
 * Toggles are applied to the view immediately and collected for `debounceMs`; then
 * all of them go out as a single bulk request. Only one request is in flight at a
 * time - changes made meanwhile wait for the next batch. If saving fails the view
 * rolls back to the server state and the failed batch can be retried.
 */
export class KillSync {
  private confirmed = new Set<number>();
  /** monsterId -> desired state, not sent yet */
  private pending = new Map<number, boolean>();
  /** monsterId -> desired state, currently being saved */
  private inFlight = new Map<number, boolean>();
  private failed = new Map<number, boolean>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: SyncStatus = 'loading';
  private error: string | null = null;
  private disposed = false;

  constructor(
    private readonly backend: KillSyncBackend,
    private readonly onChange: (state: KillSyncState) => void,
    private readonly debounceMs = 400,
  ) {}

  async load(): Promise<void> {
    this.status = 'loading';
    this.emit();
    try {
      this.confirmed = new Set(await this.backend.load());
      this.status = 'idle';
      this.error = null;
    } catch (error) {
      this.status = 'error';
      this.error = (error as Error).message;
    }
    this.emit();
  }

  set(monsterIds: number[], killed: boolean): void {
    if (this.status === 'loading') return;
    for (const id of monsterIds) this.pending.set(id, killed);
    this.failed.clear();
    this.emit();
    this.schedule();
  }

  retry(): void {
    for (const [id, killed] of this.failed) {
      if (!this.pending.has(id)) this.pending.set(id, killed);
    }
    this.failed.clear();
    void this.flush();
  }

  /** Sends whatever is pending right away (used before switching characters). */
  flush = async (): Promise<void> => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inFlight.size > 0 || this.pending.size === 0) return;

    const add: number[] = [];
    const remove: number[] = [];
    for (const [id, killed] of this.pending) {
      if (killed !== this.confirmed.has(id)) (killed ? add : remove).push(id);
    }
    this.inFlight = this.pending;
    this.pending = new Map();

    if (add.length === 0 && remove.length === 0) {
      this.inFlight = new Map();
      this.emit();
      return;
    }

    this.status = 'saving';
    this.emit();
    try {
      this.confirmed = new Set(await this.backend.save(add, remove));
      this.status = 'saved';
      this.error = null;
    } catch (error) {
      this.failed = this.inFlight;
      this.status = 'error';
      this.error = (error as Error).message;
    }
    this.inFlight = new Map();
    this.emit();

    if (this.pending.size > 0) this.schedule();
  };

  dispose(): void {
    this.disposed = true;
    void this.flush();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private emit(): void {
    if (this.disposed) return;
    const killed = new Set(this.confirmed);
    for (const changes of [this.inFlight, this.pending]) {
      for (const [id, value] of changes) {
        if (value) killed.add(id);
        else killed.delete(id);
      }
    }
    this.onChange({ killed, status: this.status, error: this.error });
  }
}
