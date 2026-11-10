import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Window operations, behind an interface so tests can use a fake. */
export interface WindowManager {
  /** Visible top-level X11 windows whose WM_CLASS matches `wmClass`. */
  findByClass(wmClass: string): Promise<string[]>;
  activate(windowId: string): Promise<void>;
  /** The focused top-level window, or null if there is none / it can't be read. */
  activeWindow(): Promise<string | null>;
  /** The _NET_WM_PID of a window, or null. */
  pidOf(windowId: string): Promise<number | null>;
  /** WM_CLASS of a window as [instance, class]; empty if it can't be read. */
  classOf(windowId: string): Promise<string[]>;
  /** Set WM_CLASS (instance and class) on one of our own windows, e.g. "sofa-panel". */
  setClass(windowId: string, wmClass: string): Promise<void>;
  /** Utility overlays retain input; a notification-layer launch cover stays above the dock. */
  setType?(windowId: string, type: 'utility' | 'notification'): Promise<void>;
  /**
   * Mark one of our overlays as a child (WM_TRANSIENT_FOR) of the app it covers, or clear it.
   * KWin keeps a fullscreen window above the desktop panel only while it, or one of its
   * transients, is the active window; without this the taskbar flashes over the app
   * each time an overlay takes focus.
   */
  setTransientFor?(windowId: string, parentId: string | null): Promise<void>;
  /** Whether the window manager currently has this window in the full-screen state. */
  isFullscreen?(windowId: string): Promise<boolean>;
  screenOff(): Promise<void>;
}

/** Stdlib ctypes + system libX11: xprop cannot write a WINDOW-typed property. */
const TRANSIENT_HELPER = String.raw`
import ctypes as C, ctypes.util, sys
x = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
x.XOpenDisplay.argtypes = [C.c_char_p]; x.XOpenDisplay.restype = C.c_void_p
x.XSetTransientForHint.argtypes = [C.c_void_p, C.c_ulong, C.c_ulong]
x.XDeleteProperty.argtypes = [C.c_void_p, C.c_ulong, C.c_ulong]
x.XSync.argtypes = [C.c_void_p, C.c_int]; x.XCloseDisplay.argtypes = [C.c_void_p]
x.XSetErrorHandler.argtypes = [C.c_void_p]
@C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)
def ignore(display, event): return 0
x.XSetErrorHandler(C.cast(ignore, C.c_void_p))
d = x.XOpenDisplay(None)
if not d: sys.exit(1)
w, parent = int(sys.argv[1]), int(sys.argv[2])
if parent: x.XSetTransientForHint(d, w, parent)
else: x.XDeleteProperty(d, w, 68)  # XA_WM_TRANSIENT_FOR
x.XSync(d, 0); x.XCloseDisplay(d)
`;

export const CLASS_RE = /^[A-Za-z0-9._-]+$/;
export const WINDOW_ID_RE = /^\d+$/;

export class XdotoolWindowManager implements WindowManager {
  async findByClass(wmClass: string): Promise<string[]> {
    if (!CLASS_RE.test(wmClass)) throw new Error(`invalid wmClass: ${wmClass}`);
    // xdotool treats the pattern as a regex; anchor it so "sofa-yt" can't match "sofa-ytmusic".
    try {
      const { stdout } = await run('xdotool', ['search', '--onlyvisible', '--class', `^${wmClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`]);
      return stdout.split('\n').map((s) => s.trim()).filter((s) => WINDOW_ID_RE.test(s));
    } catch (e) {
      if ((e as { code?: unknown }).code === 1) return []; // xdotool exits 1 when nothing matches
      throw e; // xdotool missing, no DISPLAY, ...: the caller decides
    }
  }

  async classOf(windowId: string): Promise<string[]> {
    if (!WINDOW_ID_RE.test(windowId)) throw new Error(`invalid window id: ${windowId}`);
    try {
      // xdotool 3.2016 (Ubuntu 24.04) has no getwindowclassname; xprop (x11-utils) does the job.
      const { stdout } = await run('xprop', ['-id', windowId, 'WM_CLASS']);
      return [...stdout.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
    } catch {
      return [];
    }
  }

  async activate(windowId: string): Promise<void> {
    if (!WINDOW_ID_RE.test(windowId)) throw new Error(`invalid window id: ${windowId}`);
    // windowactivate uses the pager source indication, which bypasses KWin focus-stealing prevention.
    // A ClientMessage send is not a completed handoff: wait for KWin's active
    // window acknowledgment before a caller removes its fullscreen cover.
    await run('xdotool', ['windowactivate', '--sync', windowId], { timeout: 2000 });
  }

  async isFullscreen(windowId: string): Promise<boolean> {
    if (!WINDOW_ID_RE.test(windowId)) return false;
    try {
      const { stdout } = await run('xprop', ['-id', windowId, '_NET_WM_STATE'], { timeout: 1000 });
      return stdout.includes('_NET_WM_STATE_FULLSCREEN');
    } catch {
      return false;
    }
  }

  async activeWindow(): Promise<string | null> {
    try {
      const { stdout } = await run('xdotool', ['getactivewindow']);
      const id = stdout.trim();
      return WINDOW_ID_RE.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  async pidOf(windowId: string): Promise<number | null> {
    if (!WINDOW_ID_RE.test(windowId)) throw new Error(`invalid window id: ${windowId}`);
    try {
      const { stdout } = await run('xdotool', ['getwindowpid', windowId]);
      const pid = stdout.trim();
      return /^\d+$/.test(pid) && Number(pid) > 1 ? Number(pid) : null;
    } catch {
      return null;
    }
  }

  async setClass(windowId: string, wmClass: string): Promise<void> {
    if (!WINDOW_ID_RE.test(windowId)) throw new Error(`invalid window id: ${windowId}`);
    if (!CLASS_RE.test(wmClass)) throw new Error(`invalid wmClass: ${wmClass}`);
    await run('xdotool', ['set_window', '--classname', wmClass, '--class', wmClass, windowId]);
  }

  async setType(windowId: string, type: 'utility' | 'notification'): Promise<void> {
    if (!WINDOW_ID_RE.test(windowId) || !['utility', 'notification'].includes(type)) throw new Error('Invalid window type');
    await run('xprop', ['-id', windowId, '-f', '_NET_WM_WINDOW_TYPE', '32a', '-set', '_NET_WM_WINDOW_TYPE', type === 'utility' ? '_NET_WM_WINDOW_TYPE_UTILITY' : '_NET_WM_WINDOW_TYPE_NOTIFICATION'], { timeout: 2000 });
  }

  async setTransientFor(windowId: string, parentId: string | null): Promise<void> {
    if (!WINDOW_ID_RE.test(windowId) || (parentId !== null && !WINDOW_ID_RE.test(parentId)) || parentId === windowId) throw new Error('Invalid window id');
    await run('python3', ['-I', '-c', TRANSIENT_HELPER, windowId, parentId ?? '0'], { timeout: 2000 });
  }

  async screenOff(): Promise<void> {
    await run('xset', ['dpms', 'force', 'off']);
  }
}

/** In-memory fake for tests and for --demo mode. */
export class FakeWindowManager implements WindowManager {
  windows = new Map<string, string[]>();
  pids = new Map<string, number>();
  classes = new Map<string, string>();
  activated: string[] = [];
  transients = new Map<string, string | null>();
  active: string | null = null;
  screenOffCalls = 0;
  async findByClass(wmClass: string) {
    return this.windows.get(wmClass) ?? [];
  }
  async activate(windowId: string) {
    this.activated.push(windowId);
    this.active = windowId;
  }
  async activeWindow() {
    return this.active;
  }
  async pidOf(windowId: string) {
    return this.pids.get(windowId) ?? null;
  }
  async classOf(windowId: string) {
    const c = this.classes.get(windowId);
    return c ? [c, c] : [];
  }
  async setClass(windowId: string, wmClass: string) {
    this.classes.set(windowId, wmClass);
  }
  async setTransientFor(windowId: string, parentId: string | null) {
    this.transients.set(windowId, parentId);
  }
  async screenOff() {
    this.screenOffCalls++;
  }
}
