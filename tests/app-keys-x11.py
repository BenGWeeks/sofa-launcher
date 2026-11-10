# Run from the repository root: python3 tests/app-keys-x11.py
# Do not run this Xephyr -ac test on the TV PC.
# Requires the existing Xephyr, KWin, D-Bus and xdotool system tools.
import os, signal, subprocess, tempfile, time
with tempfile.TemporaryDirectory(prefix='sofa-x11-') as tmp:
    r,w=os.pipe()
    server=subprocess.Popen(['Xephyr','-displayfd',str(w),'-screen','900x650','-nolisten','tcp','-ac'],start_new_session=True,pass_fds=(w,),stdout=subprocess.DEVNULL,stderr=open(tmp+'/xephyr.log','w'))
    os.close(w)
    wm=None
    try:
        display=os.read(r,100).decode().strip(); os.close(r)
        if not display: raise RuntimeError('Xephyr did not start')
        env=dict(os.environ, DISPLAY=':'+display, XDG_CONFIG_HOME=tmp, XDG_CACHE_HOME=tmp)
        wm=subprocess.Popen(['dbus-run-session','--','kwin_x11'],start_new_session=True,env=env,stdout=subprocess.DEVNULL,stderr=open(tmp+'/kwin.log','w'))
        time.sleep(3)
        if wm.poll() is not None: print(open(tmp+'/kwin.log').read())
        code=subprocess.run(['node_modules/.bin/electron','--no-sandbox','tests/app-keys.electron.cjs'],env=env,timeout=40).returncode
        raise SystemExit(code)
    finally:
        for proc in [wm,server]:
            if proc:
                try: os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError: pass
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL); proc.wait()
