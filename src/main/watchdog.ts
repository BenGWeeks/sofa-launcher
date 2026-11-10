/**
 * Watches the apps the launcher opened. If one loses all its windows (crash,
 * Ctrl+W, sign-out) the launcher shows Home, so the remote never ends up on
 * a bare desktop. Polls cheaply: only while the launcher isn't in front, every
 * few seconds, one xdotool call per tracked app.
 */
import type { WindowManager } from './windows';

export interface WatchdogOptions {
  wm: Pick<WindowManager, 'findByClass'>;
  /** True while the launcher window is visible and focused (then there's nothing to watch for). */
  launcherInFront: () => boolean;
  /** An app lost its windows (`seen` false means it never showed one). */
  onGone: (appId: string, seen: boolean) => void;
  intervalMs?: number;
  /** Wait this long after launch before the first check: apps take a while to map a window. */
  graceMs?: number;
  /** Give up on an app that never showed a window after this long. */
  neverShownMs?: number;
  now?: () => number;
}

interface Tracked {
  wmClass: string;
  since: number;
  seen: boolean;
}

export class Watchdog {
  private tracked = new Map<string, Tracked>();
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private readonly intervalMs: number;
  private readonly graceMs: number;
  private readonly neverShownMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: WatchdogOptions) {
    this.intervalMs = opts.intervalMs ?? 3000;
    this.graceMs = opts.graceMs ?? 10_000;
    this.neverShownMs = opts.neverShownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Start watching an app; `seen` is true when it already has a window (activated, not spawned). */
  track(appId: string, wmClass: string, seen = false): void {
    this.tracked.set(appId, { wmClass, since: this.now(), seen });
  }

  untrack(appId: string): void {
    this.tracked.delete(appId);
  }

  trackedIds(): string[] {
    return [...this.tracked.keys()];
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One poll. Exposed for tests; the interval calls it. */
  async check(): Promise<void> {
    if (this.busy || this.tracked.size === 0 || this.opts.launcherInFront()) return;
    this.busy = true;
    try {
      const t = this.now();
      for (const [id, info] of [...this.tracked]) {
        const age = t - info.since;
        if (age < this.graceMs) continue;
        let windows: string[];
        try {
          windows = await this.opts.wm.findByClass(info.wmClass);
        } catch {
          return; // xdotool failed (not "no match"): skip this tick rather than declare everything gone
        }
        if (windows.length > 0) {
          info.seen = true;
          continue;
        }
        if (!info.seen && age < this.neverShownMs) continue;
        if (this.tracked.get(id) !== info) continue; // untracked while we were polling
        this.tracked.delete(id);
        this.opts.onGone(id, info.seen);
      }
    } finally {
      this.busy = false;
    }
  }
}
