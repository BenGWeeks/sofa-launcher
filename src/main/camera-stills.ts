/**
 * Latest stills for the home screen's camera tiles. Runs only while Home is showing: a round of
 * fetches when it appears (unless the last round is very recent), then one about every minute,
 * stopping as soon as Home is hidden. A few cameras at a time, each with a short timeout. A camera
 * whose still can't be fetched loses its still (its tile goes back to the icon) and is logged once
 * until it works again. `ids()` lists the cameras that can be asked right now: empty when no
 * Home Assistant address or token is set up, so nothing is requested at all.
 */
export const STILL_REFRESH_MS = 60_000;
export const STILL_TIMEOUT_MS = 8_000;
export const STILL_CONCURRENCY = 3;
/** Showing Home again within this long of the last round doesn't start another one at once. */
export const STILL_MIN_AGE_MS = 15_000;

type Timer = unknown;

export interface CameraStillsOptions {
  /** Camera tiles (app ids) whose still can be fetched now. */
  ids: () => string[];
  /** A still as a data URL; null or a rejection when there is none. */
  fetchStill: (id: string) => Promise<string | null>;
  /** A tile's still changed (null: back to the icon). */
  onChange: (id: string, value: string | null) => void;
  log?: (message: string) => void;
  refreshMs?: number;
  timeoutMs?: number;
  concurrency?: number;
  minAgeMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

export class CameraStills {
  private values = new Map<string, string>();
  private failing = new Set<string>();
  private active = false;
  private timer: Timer | undefined;
  private round: Promise<void> | null = null;
  private lastRound = -Infinity;
  /** Bumped by reset(): results of a round started before it are thrown away. */
  private epoch = 0;

  constructor(private opts: CameraStillsOptions) {}

  /** Current stills by tile id. */
  get stills(): Record<string, string> { return Object.fromEntries(this.values); }
  get running(): boolean { return this.active; }
  get(id: string): string | undefined { return this.values.get(id); }

  /** Home shown (true) or hidden (false). Repeated calls with the same value do nothing. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.clear();
    if (!active) return;
    const age = this.now() - this.lastRound;
    if (age >= (this.opts.minAgeMs ?? STILL_MIN_AGE_MS)) void this.refresh();
    else this.schedule((this.opts.refreshMs ?? STILL_REFRESH_MS) - age);
  }

  /** Fetch every camera's still now (one round at a time). Resolves when the round is done. */
  refresh(): Promise<void> {
    if (this.round) return this.round;
    this.clear();
    this.lastRound = this.now();
    const round: Promise<void> = this.fetchAll(this.epoch).finally(() => {
      // A round superseded by reset() leaves the new round's handle and timer alone.
      if (this.round !== round) return;
      this.round = null;
      if (this.active) this.schedule(this.opts.refreshMs ?? STILL_REFRESH_MS);
    });
    this.round = round;
    return round;
  }

  /** Stop and forget every still (e.g. the cameras or the Home Assistant address changed). */
  reset(): void {
    this.epoch++;
    this.round = null;
    this.clear();
    for (const id of [...this.values.keys()]) this.drop(id);
    this.failing.clear();
    this.lastRound = -Infinity;
    if (this.active) void this.refresh();
  }

  private now(): number { return (this.opts.now ?? Date.now)(); }
  private schedule(ms: number): void {
    this.clear();
    this.timer = (this.opts.setTimer ?? setTimeout)(() => { this.timer = undefined; if (this.active) void this.refresh(); }, Math.max(0, ms));
  }
  private clear(): void {
    if (this.timer !== undefined) (this.opts.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout)))(this.timer);
    this.timer = undefined;
  }
  private drop(id: string): void {
    if (this.values.delete(id)) this.opts.onChange(id, null);
  }

  private async fetchAll(epoch: number): Promise<void> {
    let ids: string[];
    try { ids = [...new Set(this.opts.ids())]; } catch { ids = []; }
    // Cameras no longer listed (removed, or Home Assistant not connected) lose their stills.
    for (const id of [...this.values.keys()]) if (!ids.includes(id)) this.drop(id);
    for (const id of [...this.failing]) if (!ids.includes(id)) this.failing.delete(id);
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        // Hidden mid-round: leave the rest for the next time Home shows.
        if (!this.active || epoch !== this.epoch) return;
        await this.fetchOne(id, epoch);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(this.opts.concurrency ?? STILL_CONCURRENCY, queue.length)) }, worker));
  }

  private async fetchOne(id: string, epoch: number): Promise<void> {
    let value: string | null = null;
    let reason = 'no image';
    let timer: Timer | undefined;
    try {
      value = await Promise.race([
        this.opts.fetchStill(id),
        new Promise<never>((_, reject) => { timer = (this.opts.setTimer ?? setTimeout)(() => reject(new Error('timed out')), this.opts.timeoutMs ?? STILL_TIMEOUT_MS); }),
      ]);
      if (typeof value !== 'string' || !value.startsWith('data:image/')) value = null;
    } catch (error) {
      value = null;
      reason = error instanceof Error && error.message ? error.message : 'failed';
    } finally {
      if (timer !== undefined) (this.opts.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout)))(timer);
    }
    if (epoch !== this.epoch) return; // the cameras changed meanwhile: this answer is stale
    if (value) {
      this.failing.delete(id);
      if (this.values.get(id) !== value) { this.values.set(id, value); this.opts.onChange(id, value); }
      return;
    }
    if (!this.failing.has(id)) {
      this.failing.add(id);
      this.opts.log?.(`Camera still unavailable for ${id}: ${reason}`);
    }
    this.drop(id);
  }
}
