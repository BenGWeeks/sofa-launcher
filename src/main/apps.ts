import { execFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

import type { TileState } from '@shared/types';
import { isAllowedWebUrl } from './web-url';
import { NO_BROWSER, browserTile } from './browsers';
import type { InstalledBrowser } from '../shared/browsers';
import { launchArgv } from './argv';
import type { ResolvedApp } from './config';
import type { MediaController } from './mpris';
import type { WindowManager } from './windows';

const run = promisify(execFile);

export type Spawner = (file: string, args: string[]) => Pick<ChildProcess, 'pid' | 'kill' | 'once' | 'unref'>;

const defaultSpawner: Spawner = (file, args) =>
  nodeSpawn(file, args, { detached: true, stdio: 'ignore', shell: false });

/** Is `file` executable, either as a path or on $PATH? */
export function isExecutable(file: string, path = process.env.PATH ?? ''): boolean {
  const candidates = file.includes('/') ? [file] : path.split(delimiter).filter(Boolean).map((d) => join(d, file));
  return candidates.some((c) => {
    try {
      accessSync(c, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export interface OpenResult {
  ok: boolean;
  message?: string;
  /** True when an already-running window was brought forward instead of launching. */
  activated?: boolean;
}

export interface OpenOptions {
  /** Open this URL instead of the app's own (web apps only; must be HTTPS or loopback/LAN HTTP). */
  url?: string;
  /** A two-app presentation keeps both players running. Ordinary navigation pauses the previous app. */
  pausePrevious?: boolean;
}

export interface AppManagerOptions {
  dataDir: string;
  browserFor?: (app: ResolvedApp) => InstalledBrowser | null;
  browserExtensionPath?: string;
  prepareWebApp?: (app: ResolvedApp, browser: InstalledBrowser) => void;
  /** Windows hosted by Sofa have no separately killable process. */
  managed?: {
    open(app: ResolvedApp): Promise<string>;
    close(app: ResolvedApp): Promise<boolean>;
    pause(app: ResolvedApp): Promise<void>;
  };
  flatpakInstalled?: (id: string) => Promise<boolean>;
  onToast?: (text: string) => void;
  onStateChanged?: () => void;
  spawner?: Spawner;
  isExecutable?: (f: string) => boolean;
  /** Pauses the app being left (MPRIS). Optional; best effort. */
  media?: MediaController;
  /** Awaitable Flatpak command runner; bounded to five seconds. */
  runCommand?: (file: string, args: string[], options: { timeout: number }) => Promise<unknown>;
  /** Signals process-tree kills for apps we didn't spawn ourselves. */
  killPid?: (pid: number) => void;
  /** Called when an app has been opened (spawned or activated); the watchdog hooks in here. */
  onOpened?: (app: ResolvedApp, spawned: boolean) => void;
  /** Called when an app was closed by us, or its spawn failed: nothing left to watch. */
  onClosed?: (app: ResolvedApp) => void;
  /** The Docker tile (type "containers"): set up?, and its summary dot. Opened by the launcher itself. */
  containers?: { ready(): boolean; status(): TileState['status'] };
  /**
   * Demo/screenshot mode: never start, probe or signal a real process. Launches and closes
   * that would need one are logged and refused; already-"running" (fake) windows still activate.
   */
  demo?: boolean;
}

/**
 * Launches apps, brings already-running ones to the front (never reloading),
 * pauses the one being left, and closes the ones it started.
 */
export class AppManager {
  private started = new Map<string, { app: ResolvedApp; child: Pick<ChildProcess, 'pid' | 'kill'> }>();
  /** Apps being launched right now (a held OK button must not spawn twice). */
  private launching = new Map<string, { controller: AbortController; generation: number }>();
  private navigationGeneration = 0;
  private foregroundAppId: string | null = null;
  /** Apps opened or adopted through Sofa during this session. */
  private sessionApps = new Set<string>();
  private failed = new Set<string>();
  private installations = new Map<string, { expires: number; result: Promise<boolean> }>();
  lastAppId: string | null = null;

  constructor(
    private apps: ResolvedApp[],
    private wm: WindowManager,
    private opts: AppManagerOptions,
  ) {}

  /** Hidden from home / panel / chooser, but still opened, found and closed by id. */
  private visible: ResolvedApp[] | null = null;

  /** `apps`: everything that can be opened by id; `visible`: what the home screen lists (default: all). */
  setApps(apps: ResolvedApp[], visible?: ResolvedApp[]) {
    this.apps = apps;
    this.visible = visible ?? null;
  }

  get(id: string) {
    return this.apps.find((a) => a.id === id);
  }

  list(): ResolvedApp[] {
    return this.apps;
  }

  /** The visible apps' tiles (home screen, panel, screen-in-screen chooser). */
  async states(): Promise<TileState[]> {
    return Promise.all((this.visible ?? this.apps).map((a) => this.tileState(a, true)));
  }

  /** Tiles for any apps (Edit home screen), with installed state but no window lookups. */
  async tiles(apps: ResolvedApp[]): Promise<TileState[]> {
    return Promise.all(apps.map((a) => this.tileState(a, false)));
  }

  private async tileState(a: ResolvedApp, withRunning: boolean): Promise<TileState> {
    const browser = this.opts.browserFor?.(a) ?? null;
    a = browserTile(a, browser);
    let file = '';
    try { if (a.type !== 'camera' && a.type !== 'containers') file = launchArgv(a, { dataDir: this.opts.dataDir, browser })[0]; } catch { /* not launchable */ }
    const status = a.type === 'containers' ? this.opts.containers?.status() : undefined;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      brand: a.brand,
      image: a.image,
      ...(a.group ? { group: a.group } : {}),
      ...(status ? { status } : {}),
      installed: file || a.type === 'camera' || a.type === 'containers' ? await this.installed(a, file) : false,
      running: withRunning && !this.failed.has(a.id) && (await this.wm.findByClass(a.wmClass).catch((): string[] => [])).length > 0,
    };
  }

  async isRunning(id: string): Promise<boolean> {
    const app = this.get(id);
    return !!app && (await this.wm.findByClass(app.wmClass).catch((): string[] => [])).length > 0;
  }

  /**
   * Which of our apps owns this X11 window, if any. One WM_CLASS read when
   * possible; otherwise one search per app.
   */
  async appForWindow(windowId: string | null): Promise<ResolvedApp | null> {
    if (!windowId) return null;
    const classes = (await this.wm.classOf(windowId).catch((): string[] => [])).map((c) => c.toLowerCase());
    if (classes.length) return this.apps.find((a) => classes.includes(a.wmClass.toLowerCase())) ?? null;
    for (const a of this.apps) {
      if ((await this.wm.findByClass(a.wmClass).catch((): string[] => [])).includes(windowId)) return a;
    }
    return null;
  }

  private async installed(app: ResolvedApp, file: string): Promise<boolean> {
    if (app.type === 'camera') return !!this.opts.managed;
    if (app.type === 'containers') return this.opts.containers?.ready() ?? false;
    if (!app.flatpak) return (this.opts.isExecutable ?? isExecutable)(file);
    const cached = this.installations.get(app.flatpak);
    if (cached && cached.expires > Date.now()) return cached.result;
    const probe = this.opts.flatpakInstalled ?? (this.opts.demo ? async () => true : async (id: string) => {
      await run('flatpak', ['info', id], { timeout: 5000 });
      return true;
    });
    const result = probe(app.flatpak).catch(() => false);
    this.installations.set(app.flatpak, { expires: Date.now() + 60_000, result });
    return result;
  }

  async open(id: string, options: OpenOptions = {}): Promise<OpenResult> {
    const app = this.get(id);
    if (!app) return { ok: false, message: `Unknown app: ${id}` };
    // The containers view is a launcher screen, not a window (index.ts opens it before reaching here).
    if (app.type === 'containers') return { ok: false, message: `${app.name} opens from the home screen` };
    const generation = ++this.navigationGeneration;
    const pending = this.launching.get(id);
    if (pending) {
      pending.generation = generation;
      return { ok: true };
    }
    const controller = new AbortController();
    const launch = { controller, generation };
    this.launching.set(id, launch);
    const cancelled = () => controller.signal.aborted;
    const current = () => launch.generation === this.navigationGeneration && !cancelled();
    const opened = async (spawned: boolean, window: string): Promise<OpenResult> => {
      this.opts.onOpened?.(app, spawned);
      if (!current()) return { ok: false };
      await this.wm.activate(window);
      if (!current()) return { ok: false };
      this.sessionApps.add(id);
      const previous = this.lastAppId;
      this.lastAppId = id;
      this.foregroundAppId = id;
      if (previous && previous !== id && options.pausePrevious !== false) void this.pause(previous, launch.generation);
      return spawned ? { ok: true } : { ok: true, activated: true, message: `→ ${app.name}` };
    };
    this.failed.delete(id);
    let spawnFailed = false;
    const fail = (text: string) => {
      if (spawnFailed) return;
      spawnFailed = true;
      this.failed.add(id);
      this.started.delete(id);
      if (this.lastAppId === id) this.lastAppId = null;
      controller.abort();
      this.opts.onClosed?.(app);
      if (launch.generation === this.navigationGeneration) this.opts.onToast?.(text);
      this.opts.onStateChanged?.();
    };
    try {
      const existing = await this.wm.findByClass(app.wmClass).catch((): string[] => []);
      if (!current()) return { ok: false };
      if (app.type === 'camera') {
        if (this.opts.demo) return { ok: false, message: `${app.name} isn't launched in demo mode` };
        if (!this.opts.managed) return { ok: false, message: 'Camera inputs are not configured' };
        if (options.url) return { ok: false, message: 'Camera inputs cannot open arbitrary URLs' };
        try {
          const window = await this.opts.managed.open(app);
          if (!current()) { if (!existing.length) await this.opts.managed.close(app); return { ok: false }; }
          return await opened(!existing.length, window);
        } catch { return { ok: false, message: `${app.name} could not open` }; }
      }
      if (existing.length > 0) {
        return await opened(false, existing[existing.length - 1]!);
      }
      if (options.url && (app.type !== 'web' || !isAllowedWebUrl(options.url))) {
        return { ok: false, message: `${app.name} can't open that URL` };
      }
      const browser = this.opts.browserFor?.(app) ?? null;
      if (app.type === 'web' && !browser) return { ok: false, message: NO_BROWSER };
      const [file, args] = launchArgv(options.url ? { ...app, url: options.url } : app, { dataDir: this.opts.dataDir, browserExtensionPath: this.opts.browserExtensionPath, browser });
      // The one place a launch becomes a process: never in demo mode (games, Steam, Flatpaks, anything).
      if (this.opts.demo) {
        console.log(`[demo] not launching ${app.name}: ${[file, ...args].join(' ')}`);
        return { ok: false, message: `${app.name} isn't launched in demo mode` };
      }
      const installed = await this.installed(app, file);
      if (!current()) return { ok: false };
      if (!installed) return { ok: false, message: `${app.name} isn't installed` };
      const startedAt = Date.now();
      let child: ReturnType<Spawner>;
      try {
        if (app.type === 'web') this.opts.prepareWebApp?.(app, browser!);
        child = (this.opts.spawner ?? defaultSpawner)(file, args);
      } catch {
        fail(`${app.name} couldn't start`);
        return { ok: false };
      }
      this.started.set(id, { app, child });
      child.once('error', () => {
        if (this.started.get(id)?.child === child) fail(`${app.name} couldn't start`);
      });
      child.once('exit', (code) => {
        if (this.started.get(id)?.child !== child) return;
        if (code !== 0 && Date.now() - startedAt < 2000) fail(`${app.name} couldn't start`);
        // A clean wrapper exit can hand off to another process. Keep discovering
        // and retain ownership/watchdog coverage of the matching window.
      });
      child.unref();
      // Keep the reservation until discovery and activation finish, even for slow starters.
      // Games may first install updates or compile shaders: give them longer.
      const deadline = startedAt + (app.group === 'games' ? 120_000 : 20_000);
      while (!cancelled() && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, 500);
          controller.signal.addEventListener('abort', done, { once: true });
        });
        if (cancelled()) return { ok: false };
        const windows = await this.wm.findByClass(app.wmClass).catch((): string[] => []);
        if (cancelled()) return { ok: false };
        if (windows.length) {
          return await opened(true, windows[windows.length - 1]!);
        }
      }
      if (!cancelled()) fail(`${app.name} didn't open`);
      return { ok: false };
    } finally {
      if (this.launching.get(id) === launch) this.launching.delete(id);
    }
  }

  /** Pause an app's media player (MPRIS), if it has one. Best effort. */
  async pause(id: string, generation = this.navigationGeneration): Promise<void> {
    const app = this.get(id);
    if (app?.type === 'camera') {
      if (generation === this.navigationGeneration && this.foregroundAppId !== id) await this.opts.managed?.pause(app).catch(() => undefined);
      return;
    }
    if (!app || !this.opts.media) return;
    // Games get nothing when left: Home and switching apps leave them exactly as they were.
    if (app.group === 'games') return;
    try {
      const [first] = await this.wm.findByClass(app.wmClass);
      const shouldPause = () => generation === this.navigationGeneration && this.foregroundAppId !== id;
      if (first && shouldPause()) await this.opts.media.pauseWindow(first, { flatpakId: app.flatpak, shouldPause });
    } catch {
      /* best effort */
    }
  }

  /**
   * Graceful close of one app; true only if something was actually signalled.
   * Chromium browsers exit cleanly on SIGTERM. `flatpak run` leaves a bwrap parent that doesn't
   * forward signals, so flatpak apps get `flatpak kill`. Apps we didn't spawn are
   * signalled via their windows' PIDs.
   */
  async close(id: string): Promise<boolean> {
    this.navigate();
    if (!this.started.has(id)) this.launching.get(id)?.controller.abort();
    const app = this.get(id);
    if (!app) return false;
    // No `flatpak kill`, SIGTERM or window-PID signal in demo mode: nothing real is ours to close.
    if (this.opts.demo) {
      console.log(`[demo] not closing ${app.name}`);
      return false;
    }
    const flatpakId = app.flatpak;
    const ours = this.started.get(id);
    let closed = false;
    try {
      if (app.type === 'camera') {
        closed = await this.opts.managed?.close(app) ?? false;
      } else if (flatpakId) {
        // Only forget ownership once flatpak confirms the kill succeeded.
        if (ours || (await this.wm.findByClass(app.wmClass).catch((): string[] => [])).length > 0) {
          await (this.opts.runCommand ?? run)('flatpak', ['kill', flatpakId], { timeout: 5000 });
          closed = true;
        }
      } else {
        // A hand-off command (`steam -applaunch`) may be the Steam client itself: never signal it.
        if (ours && !app.handOff) {
          try { closed = ours.child.kill('SIGTERM'); } catch { /* wrapper already exited */ }
        }
        // Desktop wrappers may have exited or handed off to a different PID.
        // Also signal the actual selected app windows, avoiding duplicate signals.
        const pids = new Set<number>();
        for (const w of await this.wm.findByClass(app.wmClass).catch((): string[] => [])) {
          const pid = await this.wm.pidOf(w);
          if (pid && pid !== process.pid && !(closed && pid === ours?.child.pid) && !(app.handOff && pid === ours?.child.pid)) pids.add(pid);
        }
        const kill = this.opts.killPid ?? ((p: number) => process.kill(p, 'SIGTERM'));
        for (const pid of pids) {
          try {
            kill(pid);
            closed = true;
          } catch {
            /* already gone */
          }
        }
      }
    } catch {
      closed = false;
    }
    if (!closed) return false;
    this.launching.get(id)?.controller.abort();
    this.started.delete(id);
    this.sessionApps.delete(id);
    if (this.lastAppId === id) this.lastAppId = null;
    this.opts.onClosed?.(app);
    return true;
  }

  /** Invalidate pending focus and pause requests when showing the launcher/Home. */
  navigate(): void {
    this.navigationGeneration++;
    this.foregroundAppId = null;
  }

  /** Graceful close of every app this launcher started. */
  async closeStarted(): Promise<void> {
    this.navigate();
    for (const [id, { controller }] of this.launching) {
      if (!this.started.has(id)) controller.abort();
    }
    await Promise.all([...this.started].filter(([, { app }]) => !app.keepOnClose).map(([id]) => this.close(id)));
  }

  startedIds(): string[] {
    return [...this.started.keys()];
  }

  /** Close apps used through Sofa, including windows that were already running. */
  async closeSession(): Promise<void> {
    this.navigate();
    for (const [id, { controller }] of this.launching) {
      if (!this.started.has(id)) controller.abort();
    }
    const ids = new Set([...this.sessionApps, ...this.started.keys()]);
    await Promise.all([...ids].filter((id) => !this.get(id)?.keepOnClose).map((id) => this.close(id)));
  }
}
