import { execFile } from 'node:child_process';
import type { Bounds, PipWindows, WindowSnapshot } from './pip';
import type { WindowManager } from './windows';
import { WINDOW_ID_RE } from './windows';

/** X11's public EWMH interface; Python uses only stdlib ctypes and system libX11. */
export const X11_HELPER = String.raw`
import ctypes as C, ctypes.util, json, sys, time
x = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
P = C.c_void_p
U = C.c_ulong
I = C.c_int
x.XOpenDisplay.argtypes = [C.c_char_p]; x.XOpenDisplay.restype = P
x.XDefaultRootWindow.argtypes = [P]; x.XDefaultRootWindow.restype = U
x.XInternAtom.argtypes = [P, C.c_char_p, I]; x.XInternAtom.restype = U
x.XGetWindowProperty.argtypes = [P,U,U,C.c_long,C.c_long,I,U,C.POINTER(U),C.POINTER(I),C.POINTER(U),C.POINTER(U),C.POINTER(P)]
x.XFree.argtypes = [P]
x.XChangeProperty.argtypes = [P,U,U,U,I,I,P,I]
x.XDeleteProperty.argtypes = [P,U,U]
x.XGetGeometry.argtypes = [P,U,C.POINTER(U),C.POINTER(I),C.POINTER(I),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint)]
x.XTranslateCoordinates.argtypes = [P,U,U,I,I,C.POINTER(I),C.POINTER(I),C.POINTER(U)]
x.XSendEvent.argtypes = [P,U,I,C.c_long,P]
x.XFlush.argtypes = [P]; x.XSync.argtypes = [P,I]; x.XCloseDisplay.argtypes = [P]
x.XGetAtomName.argtypes = [P,U]; x.XGetAtomName.restype = P
# A window can disappear between reading its geometry and properties. Suppress Xlib's
# default process exit, then report that operation as a normal controlled failure.
errors = []
@C.CFUNCTYPE(I, P, P)
def on_error(display, event):
    errors.append(True)
    return 0
x.XSetErrorHandler.argtypes = [P]; x.XSetErrorHandler(C.cast(on_error,P))
d = x.XOpenDisplay(None)
if not d: raise RuntimeError('X11 display is unavailable')
root = x.XDefaultRootWindow(d)
def atom(name): return x.XInternAtom(d,name.encode(),0)
def prop(w,name):
    typ=U(); fmt=I(); count=U(); rest=U(); data=P()
    result=x.XGetWindowProperty(d,w,atom(name),0,1024,0,0,C.byref(typ),C.byref(fmt),C.byref(count),C.byref(rest),C.byref(data))
    try:
        if result or not typ.value: return None
        if fmt.value != 32: raise RuntimeError('Unexpected X11 property format')
        return list(C.cast(data,C.POINTER(U))[:count.value])
    finally:
        if data: x.XFree(data)
def name(value):
    text=x.XGetAtomName(d,value)
    try: return C.string_at(text).decode() if text else ''
    finally:
        if text: x.XFree(text)
def setprop(w,key,typ,values):
    if values is None: x.XDeleteProperty(d,w,atom(key)); return
    data=(U*len(values))(*values)
    x.XChangeProperty(d,w,atom(key),atom(typ),32,0,C.cast(data,P),len(values))
class Data(C.Union): _fields_=[('b',C.c_char*20),('s',C.c_short*10),('l',C.c_long*5)]
class Message(C.Structure):
    _fields_=[('type',I),('serial',U),('send_event',I),('display',P),('window',U),('message_type',U),('format',I),('data',Data)]
class Event(C.Union): _fields_=[('message',Message),('pad',C.c_long*24)]
def send(w,key,values):
    e=Event(); m=e.message
    m.type=33; m.send_event=1; m.display=d; m.window=w; m.message_type=atom(key); m.format=32
    for index,value in enumerate(values): m.data.l[index]=value
    x.XSendEvent(d,root,0,(1<<19)|(1<<20),C.byref(e)); x.XFlush(d)
def state(w,key,enabled): send(w,'_NET_WM_STATE',[1 if enabled else 0,atom(key),0,2,0])
def bounds(w,b): send(w,'_NET_MOVERESIZE_WINDOW',[(2<<12)|(15<<8)|10,b['x'],b['y'],b['width'],b['height']])
def snapshot(w):
    r=U(); xx=I(); yy=I(); width=C.c_uint(); height=C.c_uint(); border=C.c_uint(); depth=C.c_uint(); child=U()
    if not x.XGetGeometry(d,w,C.byref(r),C.byref(xx),C.byref(yy),C.byref(width),C.byref(height),C.byref(border),C.byref(depth)):
        raise RuntimeError('App window has closed')
    x.XTranslateCoordinates(d,w,root,0,0,C.byref(xx),C.byref(yy),C.byref(child))
    transient=prop(w,'WM_TRANSIENT_FOR')
    pid=prop(w,'_NET_WM_PID')
    return dict(id=str(w),bounds=dict(x=xx.value,y=yy.value,width=width.value,height=height.value),states=[name(a) for a in prop(w,'_NET_WM_STATE') or []],decorations=prop(w,'_MOTIF_WM_HINTS'),transientFor=transient[0] if transient else None,ownerPid=pid[0] if pid else None)
managed=['_NET_WM_STATE_FULLSCREEN','_NET_WM_STATE_MAXIMIZED_VERT','_NET_WM_STATE_MAXIMIZED_HORZ','_NET_WM_STATE_ABOVE','_NET_WM_STATE_BELOW']
request=json.load(sys.stdin); w=int(request['id']); op=request['op']
try:
    result=None
    if 'ownerPid' in request and snapshot(w)['ownerPid'] != request['ownerPid']: raise RuntimeError('App window was replaced')
    if op=='snapshot': result=snapshot(w)
    elif op=='prepare':
        snapshot(w)
        for key in managed: state(w,key,False)
        # Wait for KWin to leave fullscreen/maximized before geometry requests.
        deadline=time.monotonic()+2
        while any(name(a) in managed[:3] for a in prop(w,'_NET_WM_STATE') or []):
            if time.monotonic()>deadline: raise RuntimeError('App refused to leave fullscreen')
            time.sleep(.025)
        setprop(w,'_MOTIF_WM_HINTS','_MOTIF_WM_HINTS',[2,0,0,0,0])
        if 'base' in request: setprop(w,'WM_TRANSIENT_FOR','WINDOW',[int(request['base'])])
        state(w,'_NET_WM_STATE_ABOVE',True)
        bounds(w,request['bounds'])
    elif op=='raise':
        snapshot(w)
        # KWin's active fullscreen layer outranks ordinary keep-above windows.
        # Only Sofa's non-focusable camera uses this layer; it is closed on stop.
        # Unlike OSD windows, critical notifications retain their chosen geometry.
        setprop(w,'_NET_WM_WINDOW_TYPE','ATOM',[atom('_KDE_NET_WM_WINDOW_TYPE_CRITICAL_NOTIFICATION'),atom('_NET_WM_WINDOW_TYPE_NOTIFICATION')])
        state(w,'_NET_WM_STATE_ABOVE',True)
        send(w,'_NET_RESTACK_WINDOW',[2,0,0,0,0])
    elif op=='move': snapshot(w); bounds(w,request['bounds'])
    elif op=='restore':
        snapshot(w); saved=request['snapshot']
        for key in managed: state(w,key,False)
        x.XSync(d,0); time.sleep(.05)
        setprop(w,'WM_TRANSIENT_FOR','WINDOW',None if saved['transientFor'] is None else [saved['transientFor']])
        setprop(w,'_MOTIF_WM_HINTS','_MOTIF_WM_HINTS',saved['decorations'])
        bounds(w,saved['bounds'])
        for key in managed[1:]:
            if key in saved['states']: state(w,key,True)
        x.XSync(d,0); time.sleep(.1)
        if managed[0] in saved['states']: state(w,managed[0],True)
    else: raise RuntimeError('Unknown window operation')
    x.XSync(d,0)
    if errors: raise RuntimeError('App window is unavailable')
    print(json.dumps(result))
finally: x.XCloseDisplay(d)
`;

export class X11PipWindows implements PipWindows {
  constructor(private wm: WindowManager) {}

  private run<T>(id: string, op: string, extra: Record<string, unknown> = {}): Promise<T> {
    if (!WINDOW_ID_RE.test(id)) return Promise.reject(new Error('Invalid window id'));
    return new Promise<T>((resolve, reject) => {
      const child = execFile('python3', ['-c', X11_HELPER], { timeout: 6000, maxBuffer: 64_000 }, (error, stdout) => {
        if (error) return reject(new Error('Couldn’t change the app window. Screen-in-screen requires an X11 desktop and python3.'));
        try { resolve(JSON.parse(stdout) as T); } catch { reject(new Error('Couldn’t read app window state')); }
      });
      child.stdin?.end(JSON.stringify({ id, op, ...extra }));
      child.stdin?.on('error', () => undefined);
    });
  }

  snapshot(id: string): Promise<WindowSnapshot> { return this.run(id, 'snapshot'); }
  async inset(base: WindowSnapshot, inset: WindowSnapshot, screen: Bounds, bounds: Bounds): Promise<void> {
    await this.run(base.id, 'prepare', { bounds: screen, ownerPid: base.ownerPid });
    await this.run(inset.id, 'prepare', { bounds, base: base.id, ownerPid: inset.ownerPid });
  }
  async preparePinned(id: string, bounds: Bounds): Promise<void> {
    const saved = await this.snapshot(id);
    await this.run(id, 'prepare', { bounds, ownerPid: saved.ownerPid });
  }
  keepAbove(id: string): Promise<void> { return this.run(id, 'raise'); }
  restore(snapshot: WindowSnapshot): Promise<void> { return this.run(snapshot.id, 'restore', { snapshot, ownerPid: snapshot.ownerPid }); }
  move(snapshot: WindowSnapshot, bounds: Bounds): Promise<void> { return this.run(snapshot.id, 'move', { bounds, ownerPid: snapshot.ownerPid }); }
  async activate(snapshot: WindowSnapshot): Promise<void> {
    if ((await this.snapshot(snapshot.id)).ownerPid !== snapshot.ownerPid) throw new Error('App window was replaced');
    await this.wm.activate(snapshot.id);
  }
}
