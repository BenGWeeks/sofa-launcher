import { spawn as nodeSpawn } from 'node:child_process';

/**
 * Hides the mouse pointer everywhere on the X11 display after it has been still for a
 * while, and shows it again as soon as it moves. The home screen and the browser apps
 * already hide their own pointer; this covers every other window (players, desktop
 * apps, the desktop itself), so a nudged mouse never leaves an arrow over a film.
 *
 * Stdlib ctypes + libXfixes, like the other X11 helpers: no extra package. The X server
 * undoes XFixesHideCursor when the helper's connection closes, and the helper exits when
 * Sofa's end of its stdin closes, so the pointer cannot stay hidden after Sofa has gone.
 */
export const IDLE_POINTER_HELPER = String.raw`
import ctypes as C, ctypes.util, os, select, sys, time
x = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
f = C.CDLL(ctypes.util.find_library('Xfixes') or 'libXfixes.so.3')
x.XOpenDisplay.argtypes = [C.c_char_p]; x.XOpenDisplay.restype = C.c_void_p
x.XDefaultRootWindow.argtypes = [C.c_void_p]; x.XDefaultRootWindow.restype = C.c_ulong
x.XQueryPointer.argtypes = [C.c_void_p, C.c_ulong] + [C.c_void_p] * 7
x.XFlush.argtypes = [C.c_void_p]
f.XFixesHideCursor.argtypes = [C.c_void_p, C.c_ulong]
f.XFixesShowCursor.argtypes = [C.c_void_p, C.c_ulong]
idle = float(sys.argv[1])
d = x.XOpenDisplay(None)
if not d: sys.exit(1)
root = x.XDefaultRootWindow(d)
def position():
    r = C.c_ulong(); c = C.c_ulong(); rx = C.c_int(); ry = C.c_int(); wx = C.c_int(); wy = C.c_int(); mask = C.c_uint()
    x.XQueryPointer(d, root, C.byref(r), C.byref(c), C.byref(rx), C.byref(ry), C.byref(wx), C.byref(wy), C.byref(mask))
    return rx.value, ry.value
hidden = False; last = position(); moved = time.monotonic()
while True:
    # Poll faster while hidden, so the pointer is back promptly when the mouse is nudged.
    if select.select([0], [], [], 0.1 if hidden else 0.25)[0] and not os.read(0, 64): break
    now = position(); t = time.monotonic()
    if now != last:
        last = now; moved = t
        if hidden: f.XFixesShowCursor(d, root); x.XFlush(d); hidden = False
    elif not hidden and t - moved >= idle:
        f.XFixesHideCursor(d, root); x.XFlush(d); hidden = True
`;

export interface IdlePointerChild {
  stdin: { end(): void } | null;
  kill(): boolean;
  once(event: 'exit' | 'error', listener: () => void): unknown;
}
export type IdlePointerSpawner = (file: string, args: string[]) => IdlePointerChild;

const defaultSpawner: IdlePointerSpawner = (file, args) =>
  nodeSpawn(file, args, { stdio: ['pipe', 'ignore', 'ignore'] });

/** Owns the helper process: at most one, started once, stopped with the launcher. */
export class IdlePointer {
  private child: IdlePointerChild | null = null;

  constructor(private readonly idleSeconds = 3, private readonly spawner: IdlePointerSpawner = defaultSpawner) {}

  get running(): boolean { return !!this.child; }

  start(): void {
    if (this.child) return;
    let child: IdlePointerChild;
    try {
      child = this.spawner('python3', ['-I', '-c', IDLE_POINTER_HELPER, String(this.idleSeconds)]);
    } catch {
      return; // best effort: the pointer simply stays visible
    }
    this.child = child;
    const gone = () => { if (this.child === child) this.child = null; };
    child.once('exit', gone);
    child.once('error', gone);
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try { child.stdin?.end(); } catch { /* already closed */ }
    try { child.kill(); } catch { /* already gone */ }
  }
}
