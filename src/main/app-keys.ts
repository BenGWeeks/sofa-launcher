import { execFile } from 'node:child_process';

/**
 * Remote buttons arrive as global shortcuts, and on X11 a global shortcut is a passive
 * key grab: from the moment the button's key goes down until it comes up, the whole
 * keyboard belongs to the launcher. A key Sofa synthesises for the app in front during
 * that time (Back's Escape, Ctrl+Shift+F8, …) is delivered to the launcher instead, and
 * the app sees nothing. xdotool's own tap is a few milliseconds long, but a real remote
 * holds the key for as long as the button is pressed.
 *
 * This helper snapshots the keys held when it starts and exits once all of them are up
 * (or after the timeout, given in milliseconds). Python and libX11 only, like X11_HELPER.
 */
export const KEYS_RELEASED_HELPER = String.raw`
import ctypes as C, sys, time
x = C.CDLL('libX11.so.6')
x.XOpenDisplay.argtypes = [C.c_char_p]; x.XOpenDisplay.restype = C.c_void_p
x.XQueryKeymap.argtypes = [C.c_void_p, C.c_char * 32]
x.XCloseDisplay.argtypes = [C.c_void_p]
d = x.XOpenDisplay(None)
if not d: sys.exit(2)
def held():
    keys = (C.c_char * 32)()
    x.XQueryKeymap(d, keys)
    return keys.raw
try:
    deadline = time.monotonic() + float(sys.argv[1]) / 1000
    pressed = held()
    while any(a & b for a, b in zip(pressed, held())):
        if time.monotonic() > deadline:
            break
        time.sleep(0.01)
finally: x.XCloseDisplay(d)
`;

/** Resolves once the keys held right now are released, or after `timeoutMs`. Never rejects. */
export function waitForKeysReleased(timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    execFile('python3', ['-I', '-c', KEYS_RELEASED_HELPER, String(timeoutMs)], { timeout: timeoutMs + 1000 }, () => resolve());
  });
}

/**
 * Send a key (xdotool syntax, e.g. "ctrl+shift+F8") to the window in front, after the
 * remote button that asked for it has been released. Returns false when dropped.
 */
export function appKeySender(deps: {
  waitReleased: () => Promise<void>;
  activeWindow: () => Promise<string | null>;
  xdotool: (args: string[]) => Promise<void>;
}): (key: string) => Promise<boolean> {
  const inFlight = new Set<string>();
  return async (key) => {
    // X auto-repeat can outlast the shortcut debounce while the button is held.
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    try {
      const target = await deps.activeWindow();
      if (target === null) return false;
      await deps.waitReleased();
      // Home or another focus change during the wait cancels this stale action.
      if (await deps.activeWindow() !== target) return false;
      await deps.xdotool(['key', '--clearmodifiers', key]);
      return true;
    } finally {
      inFlight.delete(key);
    }
  };
}

/** All synthetic app chords share the release guard, including media/helper hotkeys. */
export const sendKeysToApp = appKeySender({
  waitReleased: waitForKeysReleased,
  activeWindow: () => new Promise<string | null>((resolve) => {
    execFile('xdotool', ['getactivewindow'], { timeout: 2000 }, (error, stdout) => {
      const id = stdout?.trim();
      resolve(!error && /^\d+$/.test(id) ? id : null);
    });
  }),
  xdotool: (args) => new Promise<void>((resolve, reject) => {
    execFile('xdotool', args, { timeout: 2000 }, (error) => error ? reject(error) : resolve());
  }),
});
