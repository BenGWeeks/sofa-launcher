/**
 * Opens the slide-up panel when the mouse pointer is pushed against the bottom edge of the
 * screen and held there for a moment, like an auto-hiding dock. It gives someone holding a
 * mouse rather than the remote a way to reach the panel.
 *
 * The pointer has to arrive at the edge: one already resting there (at start-up, or since
 * before the app came to the front) opens nothing until it has left and come back.
 */
export interface EdgePoint { x: number; y: number }
export interface EdgeBounds { x: number; y: number; width: number; height: number }

export interface EdgeRevealOptions {
  cursor(): EdgePoint;
  /** The screen whose bottom edge counts. */
  screen(): EdgeBounds;
  /** Whether the edge may open the panel right now. */
  enabled(): boolean;
  reveal(): void;
  intervalMs?: number;
  /** Samples in a row the pointer must rest on the edge. */
  dwell?: number;
}

/** Rows of pixels at the bottom that count as the edge (the cursor is reported in scaled units). */
const EDGE_ROWS = 2;

export class EdgeReveal {
  private timer?: ReturnType<typeof setInterval>;
  private armed = false;
  private resting = 0;

  constructor(private readonly options: EdgeRevealOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), this.options.intervalMs ?? 100);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.armed = false;
    this.resting = 0;
  }

  /** One look at the pointer. Public for tests; `start` calls it on a timer. */
  sample(): void {
    let onEdge = false;
    try {
      const { x, y } = this.options.cursor();
      const b = this.options.screen();
      const bottom = b.y + b.height;
      onEdge = x >= b.x && x < b.x + b.width && y >= bottom - EDGE_ROWS && y < bottom;
    } catch {
      /* no pointer to read: treat it as away from the edge */
    }
    if (!onEdge) {
      this.armed = true;
      this.resting = 0;
      return;
    }
    if (!this.armed) return;
    if (!this.options.enabled()) {
      // Reached the edge while it does nothing (home screen, open panel): it must leave first.
      this.armed = false;
      this.resting = 0;
      return;
    }
    if (++this.resting < (this.options.dwell ?? 3)) return;
    this.armed = false;
    this.resting = 0;
    this.options.reveal();
  }
}
