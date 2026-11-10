/** Temporary remote-to-mouse controls for apps without directional navigation. */
export interface PointerOptions {
  register(key: string, callback: () => void): boolean;
  unregister(key: string): void;
  activeWindow(): Promise<string | null>;
  command(args: string[]): Promise<void>;
  onStopped?(): void;
  now?: () => number;
}

const KEYS = ['Up', 'Down', 'Left', 'Right', 'Return', 'PageUp', 'PageDown'];

export class RemotePointer {
  private target: string | null = null;
  private generation = 0;
  private claimed: string[] = [];
  private busy = false;
  private lastMove = 0;
  private lastClick = -Infinity;
  private repeats = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private options: PointerOptions) {}

  get active(): boolean { return this.target !== null; }

  start(window: string): boolean {
    this.stop();
    this.target = window;
    this.repeats = 0;
    this.lastMove = 0;
    this.lastClick = -Infinity;
    for (const key of KEYS) {
      try {
        if (!this.options.register(key, () => void this.press(key))) {
          this.stop();
          return false;
        }
        this.claimed.push(key);
      } catch {
        this.stop();
        return false;
      }
    }
    // Release the keys if focus leaves the app, even without another key press.
    this.timer = setInterval(() => void this.checkFocus(), 250);
    this.timer.unref?.();
    return true;
  }

  stop(): void {
    const wasActive = this.active;
    this.target = null;
    this.generation++;
    clearInterval(this.timer);
    for (const key of this.claimed) this.options.unregister(key);
    this.claimed = [];
    if (wasActive) this.options.onStopped?.();
  }

  private async checkFocus(): Promise<void> {
    const generation = this.generation;
    const active = await this.options.activeWindow().catch(() => null);
    if (generation === this.generation && active !== this.target) this.stop();
  }

  private async press(key: string): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const active = await this.options.activeWindow();
      if (generation !== this.generation) return;
      if (active !== this.target) return this.stop();
      const now = (this.options.now ?? Date.now)();
      if (key === 'Return') {
        if (now - this.lastClick < 350) return;
        this.lastClick = now;
        await this.options.command(['click', '1']);
      } else if (key === 'PageUp' || key === 'PageDown') {
        await this.options.command(['click', key === 'PageUp' ? '4' : '5']);
      } else {
        this.repeats = now - this.lastMove < 300 ? this.repeats + 1 : 0;
        this.lastMove = now;
        const step = Math.min(96, 16 + this.repeats * 4);
        const x = key === 'Left' ? -step : key === 'Right' ? step : 0;
        const y = key === 'Up' ? -step : key === 'Down' ? step : 0;
        await this.options.command(['mousemove_relative', '--', String(x), String(y)]);
      }
    } catch {
      if (generation === this.generation) this.stop();
    } finally {
      this.busy = false;
    }
  }
}
