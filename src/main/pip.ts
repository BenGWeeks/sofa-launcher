import type { PipState } from '@shared/types';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface PipWindow { appId: string; name: string; windowId: string; camera?: boolean }
export interface WindowSnapshot {
  id: string;
  bounds: Bounds;
  states: string[];
  decorations: number[] | null;
  transientFor: number | null;
  ownerPid: number | null;
}
export interface PipWindows {
  pin?(window: PipWindow, bounds: Bounds): Promise<void>;
  raise?(window: PipWindow): Promise<void>;
  closePinned?(window: PipWindow): Promise<void>;
  snapshot(id: string): Promise<WindowSnapshot>;
  inset(base: WindowSnapshot, inset: WindowSnapshot, screen: Bounds, bounds: Bounds): Promise<void>;
  restore(snapshot: WindowSnapshot): Promise<void>;
  move(window: WindowSnapshot, bounds: Bounds): Promise<void>;
  activate(window: WindowSnapshot): Promise<void>;
}

const SIZES = [0.3, 0.4, 0.5];
export function insetBounds(screen: Bounds, corner: number, size: number): Bounds {
  const margin = Math.max(12, Math.round(screen.width * 0.015));
  const width = Math.round(Math.min(screen.width * SIZES[size % SIZES.length]!, (screen.height - margin * 2) * 16 / 9));
  const height = Math.round(width * 9 / 16);
  return {
    x: screen.x + (corner === 0 || corner === 3 ? screen.width - width - margin : margin),
    y: screen.y + (corner < 2 ? screen.height - height - margin : margin),
    width, height,
  };
}

/** Owns only the two selected windows and restores their original presentation. */
export class PipManager {
  private pair: { base: PipWindow | null; inset: PipWindow; baseSnapshot: WindowSnapshot; insetSnapshot: WindowSnapshot; screen: Bounds } | null = null;
  private corner = 0;
  private size = 0;
  private focused: 'base' | 'inset' = 'base';
  private expanded = false;
  private epoch = 0;
  get revision(): number { return this.epoch; }
  private tail: Promise<unknown> = Promise.resolve();
  private checking = false;

  constructor(private windows: PipWindows, private changed: (state: PipState) => void = () => undefined, private notice: (text: string) => void = () => undefined) {}

  get pinned(): boolean { return !!this.pair?.inset.camera; }

  get state(): PipState {
    return this.pair ? { active: true, pinned: this.pinned, baseId: this.pair.base?.appId, insetId: this.pair.inset.appId, focused: this.focused, expanded: this.expanded, corner: this.corner, size: this.size } : { active: false };
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  start(base: PipWindow, inset: PipWindow, screen: Bounds): Promise<void> {
    return this.serial(async () => {
      if (base.windowId === inset.windowId || base.appId === inset.appId) throw new Error('Choose two different apps');
      await this.restore();
      // Capture both before changing either; a failed setup can always roll back.
      const baseSnapshot = await this.windows.snapshot(base.windowId);
      const insetSnapshot = await this.windows.snapshot(inset.windowId);
      this.pair = { base, inset, baseSnapshot, insetSnapshot, screen };
      this.epoch++;
      this.corner = this.size = 0;
      this.focused = 'base';
      this.expanded = false;
      try {
        if (inset.camera) await this.windows.pin!(inset, insetBounds(screen, this.corner, this.size));
        else await this.windows.inset(baseSnapshot, insetSnapshot, screen, insetBounds(screen, this.corner, this.size));
        await this.windows.activate(baseSnapshot);
        this.changed(this.state);
      } catch (error) {
        await this.restore();
        throw error;
      }
    });
  }

  /** Closing the foreground app leaves an independent camera pinned. */
  closing(appId: string): Promise<void> {
    return this.serial(async () => {
      if (this.pinned && this.pair?.base?.appId === appId) {
        this.pair.base = null;
        this.epoch++;
        this.changed(this.state);
        return;
      }
      if (this.pair && (appId === this.pair.inset.appId || (!this.pinned && appId === this.pair.base?.appId))) await this.restore();
    });
  }

  stop(): Promise<void> { return this.serial(() => this.restore()); }

  private async restore(): Promise<void> {
    const pair = this.pair;
    this.pair = null;
    this.expanded = false;
    if (!pair) return;
    this.epoch++;
    // Either window may already have closed. Still restore the survivor.
    const results = await Promise.allSettled(pair.inset.camera
      ? [this.windows.closePinned!(pair.inset)]
      : [this.windows.restore(pair.insetSnapshot), this.windows.restore(pair.baseSnapshot)]);
    this.changed(this.state);
    if (results.some((result) => result.status === 'rejected')) this.notice('Screen-in-screen stopped; a window closed or could not be restored');
  }

  focus(which: 'base' | 'inset'): Promise<void> {
    return this.serial(async () => {
      if (this.pinned && which === 'base' && !this.pair?.base) {
        this.notice('Main app closed; open an app to control it');
        return;
      }
      const target = this.pair?.[which];
      if (!target) throw new Error('Screen-in-screen is not active');
      if (this.pinned && which === 'inset') return;
      if (which === 'base') await this.collapse();
      try {
        await this.windows.activate(which === 'base' ? this.pair!.baseSnapshot : this.pair!.insetSnapshot);
        this.focused = which;
      } finally { this.changed(this.state); }
      this.notice(`Remote controls: ${target.name}`);
    });
  }

  /** Give the inset the whole viewport for browsing, without entering native fullscreen. */
  browse(): Promise<void> {
    return this.serial(async () => {
      const pair = this.pair;
      if (!pair) throw new Error('Screen-in-screen is not active');
      if (this.pinned) return;
      if (!this.expanded) {
        await this.windows.move(pair.insetSnapshot, pair.screen);
        this.expanded = true;
      }
      try {
        await this.windows.activate(pair.insetSnapshot);
        this.focused = 'inset';
      } finally { this.changed(this.state); }
      this.notice(`Browse ${pair.inset.name} · Menu returns to screen-in-screen controls`);
    });
  }

  /** Return the inset to its selected size/corner and keep its remote controls. */
  shrink(): Promise<void> {
    return this.serial(async () => {
      const pair = this.pair;
      if (!pair) throw new Error('Screen-in-screen is not active');
      if (this.pinned) return;
      await this.collapse();
      try {
        await this.windows.activate(pair.insetSnapshot);
        this.focused = 'inset';
      } finally { this.changed(this.state); }
    });
  }

  private async collapse(): Promise<void> {
    if (!this.pair || !this.expanded) return;
    await this.windows.move(this.pair.insetSnapshot, insetBounds(this.pair.screen, this.corner, this.size));
    this.expanded = false;
  }

  move(): Promise<void> {
    return this.serial(async () => {
      if (!this.pair) return;
      this.corner = (this.corner + 1) % 4;
      await this.windows.move(this.pair.insetSnapshot, insetBounds(this.pair.screen, this.corner, this.size));
      this.expanded = false;
      this.changed(this.state);
    });
  }

  resize(): Promise<void> {
    return this.serial(async () => {
      if (!this.pair) return;
      this.size = (this.size + 1) % SIZES.length;
      await this.windows.move(this.pair.insetSnapshot, insetBounds(this.pair.screen, this.corner, this.size));
      this.expanded = false;
      this.changed(this.state);
    });
  }

  /** Home preserves both kinds of inset; raising never activates the camera. */
  home(): Promise<void> { return this.serial(async () => { if (this.pinned) await this.windows.raise!(this.pair!.inset); }); }

  /** App pairs end when a different app opens; a camera is independent of its base. */
  opening(appId: string): Promise<void> {
    return this.serial(async () => {
      if (this.pair && !this.pinned && ![this.pair.base?.appId, this.pair.inset.appId].includes(appId)) await this.restore();
    });
  }

  opened(base: PipWindow): Promise<void> {
    return this.serial(async () => {
      if (!this.pinned || !this.pair || base.appId === this.pair.inset.appId) return;
      const snapshot = await this.windows.snapshot(base.windowId);
      this.pair.base = base;
      this.pair.baseSnapshot = snapshot;
      this.focused = 'base';
      this.epoch++;
      await this.windows.raise!(this.pair.inset);
      this.changed(this.state);
    });
  }

  /** Check infrequently while active; never let a closed app leave the survivor altered. */
  async check(): Promise<void> {
    if (!this.pair || this.checking) return;
    this.checking = true;
    const pair = this.pair;
    try {
      if (pair.inset.camera) {
        const inset = await this.windows.snapshot(pair.inset.windowId);
        if (inset.ownerPid !== pair.insetSnapshot.ownerPid) throw new Error('Camera window was replaced');
        const base = pair.base;
        if (base) {
          try {
            const current = await this.windows.snapshot(base.windowId);
            if (current.ownerPid !== pair.baseSnapshot.ownerPid) throw new Error('Base window was replaced');
          } catch {
            await this.serial(async () => {
              if (this.pair !== pair || pair.base !== base) return;
              pair.base = null;
              this.epoch++;
              this.changed(this.state);
            });
          }
        }
        return;
      }
      const [base, inset] = await Promise.all([this.windows.snapshot(pair.base!.windowId), this.windows.snapshot(pair.inset.windowId)]);
      if (base.ownerPid !== pair.baseSnapshot.ownerPid || inset.ownerPid !== pair.insetSnapshot.ownerPid) throw new Error('App window was replaced');
      if (base.states.includes('_NET_WM_STATE_FULLSCREEN') || inset.states.includes('_NET_WM_STATE_FULLSCREEN')) {
        if (this.pair === pair) {
          await this.stop();
          this.notice('An app entered fullscreen, so screen-in-screen stopped');
        }
      }
    } catch {
      if (this.pair === pair) await this.stop();
    } finally { this.checking = false; }
  }
}
