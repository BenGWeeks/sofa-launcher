import { describe, expect, it, vi } from 'vitest';
import { insetBounds, PipManager, type PipWindow, type PipWindows, type WindowSnapshot } from '../src/main/pip';

const screen = { x: 100, y: 200, width: 3840, height: 2160 };
const base: PipWindow = { appId: 'jellyfin', name: 'Jellyfin', windowId: '123' };
const inset: PipWindow = { appId: 'youtube', name: 'YouTube', windowId: '456' };
const snapshot = (id: string): WindowSnapshot => ({ id, bounds: { x: 10, y: 20, width: 1280, height: 720 }, states: ['_NET_WM_STATE_FULLSCREEN'], decorations: null, transientFor: null, ownerPid: Number(id) });
function fixture() {
  const windows: PipWindows = {
    pin: vi.fn(async () => undefined),
    raise: vi.fn(async () => undefined),
    closePinned: vi.fn(async () => undefined),
    snapshot: vi.fn(async (id: string) => snapshot(id)),
    inset: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    activate: vi.fn(async () => undefined),
  };
  const changed = vi.fn();
  const notice = vi.fn();
  return { windows, changed, notice, pip: new PipManager(windows, changed, notice) };
}

describe('screen-in-screen window ownership', () => {
  it('snapshots both windows before changing either, then gives the main app the remote', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    expect(windows.snapshot).toHaveBeenNthCalledWith(1, '123');
    expect(windows.snapshot).toHaveBeenNthCalledWith(2, '456');
    expect(windows.inset).toHaveBeenCalledWith(snapshot('123'), snapshot('456'), screen, insetBounds(screen, 0, 0));
    expect(windows.activate).toHaveBeenCalledWith(snapshot('123'));
    expect(pip.state).toMatchObject({ active: true, baseId: 'jellyfin', insetId: 'youtube' });
  });

  it('does not change either window when the second disappears before setup', async () => {
    const { windows, pip } = fixture();
    vi.mocked(windows.snapshot).mockRejectedValueOnce(new Error('closed'));
    await expect(pip.start(base, inset, screen)).rejects.toThrow('closed');
    expect(windows.inset).not.toHaveBeenCalled();
    expect(pip.state.active).toBe(false);
  });

  it('rolls both windows back after a partially failed setup', async () => {
    const { windows, pip } = fixture();
    vi.mocked(windows.inset).mockRejectedValueOnce(new Error('unsupported'));
    await expect(pip.start(base, inset, screen)).rejects.toThrow('unsupported');
    expect(windows.restore).toHaveBeenCalledWith(snapshot('123'));
    expect(windows.restore).toHaveBeenCalledWith(snapshot('456'));
    expect(pip.state.active).toBe(false);
  });

  it('restores the survivor when the other window has closed', async () => {
    const { windows, pip, notice } = fixture();
    await pip.start(base, inset, screen);
    vi.mocked(windows.snapshot).mockRejectedValueOnce(new Error('closed'));
    vi.mocked(windows.restore).mockRejectedValueOnce(new Error('closed'));
    await pip.check();
    expect(windows.restore).toHaveBeenCalledWith(snapshot('123'));
    expect(windows.restore).toHaveBeenCalledWith(snapshot('456'));
    expect(pip.state.active).toBe(false);
    expect(notice).toHaveBeenCalled();
  });

  it('stops when an X11 id is reused by a replacement process', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    vi.mocked(windows.snapshot).mockResolvedValueOnce({ ...snapshot('123'), ownerPid: 9999 });
    await pip.check();
    expect(pip.state.active).toBe(false);
  });

  it('restores both windows when an app explicitly enters fullscreen again', async () => {
    const { windows, pip, notice } = fixture();
    await pip.start(base, inset, screen);
    await pip.check();
    expect(pip.state.active).toBe(false);
    expect(notice).toHaveBeenCalledWith('An app entered fullscreen, so screen-in-screen stopped');
  });

  it('serializes an immediate stop behind a pending setup and restores once', async () => {
    const { windows, pip } = fixture();
    let finish!: () => void;
    vi.mocked(windows.inset).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const starting = pip.start(base, inset, screen);
    await vi.waitFor(() => expect(windows.inset).toHaveBeenCalled());
    const stopping = pip.stop();
    finish();
    await Promise.all([starting, stopping]);
    await pip.stop();
    expect(windows.restore).toHaveBeenCalledTimes(2);
    expect(pip.state.active).toBe(false);
  });

  it('restores an existing pair before starting a different pair', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await pip.start(inset, { appId: 'audible', name: 'Audible', windowId: '789' }, screen);
    expect(windows.restore).toHaveBeenCalledTimes(2);
    expect(pip.state).toMatchObject({ baseId: 'youtube', insetId: 'audible' });
  });

  it('rejects a duplicate app or window without disturbing the active pair', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await expect(pip.start(base, base, screen)).rejects.toThrow('different apps');
    expect(windows.restore).not.toHaveBeenCalled();
    expect(pip.state.active).toBe(true);
  });

  it('expands the inset for browsing and returns it to the selected corner and size', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await pip.move();
    await pip.resize();
    await pip.browse();
    expect(windows.move).toHaveBeenLastCalledWith(snapshot('456'), screen);
    expect(windows.activate).toHaveBeenLastCalledWith(snapshot('456'));
    expect(pip.state).toMatchObject({ expanded: true, focused: 'inset', corner: 1, size: 1 });
    await pip.shrink();
    expect(windows.move).toHaveBeenLastCalledWith(snapshot('456'), insetBounds(screen, 1, 1));
    expect(pip.state).toMatchObject({ expanded: false, focused: 'inset', corner: 1, size: 1 });
  });

  it('collapses an enlarged inset before giving the main window the remote', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await pip.browse();
    vi.mocked(windows.move).mockClear();
    vi.mocked(windows.activate).mockClear();
    await pip.focus('base');
    expect(windows.move).toHaveBeenCalledWith(snapshot('456'), insetBounds(screen, 0, 0));
    expect(vi.mocked(windows.move).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(windows.activate).mock.invocationCallOrder[0]!);
    expect(pip.state).toMatchObject({ expanded: false, focused: 'base' });
  });

  it('move and resize both leave browsing mode', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await pip.browse();
    await pip.move();
    expect(windows.move).toHaveBeenLastCalledWith(snapshot('456'), insetBounds(screen, 1, 0));
    expect(pip.state.expanded).toBe(false);
    await pip.browse();
    await pip.resize();
    expect(windows.move).toHaveBeenLastCalledWith(snapshot('456'), insetBounds(screen, 1, 1));
    expect(pip.state.expanded).toBe(false);
  });

  it('retains the actual enlarged state if focusing it fails, and can still collapse', async () => {
    const { windows, pip, changed } = fixture();
    await pip.start(base, inset, screen);
    vi.mocked(windows.activate).mockRejectedValueOnce(new Error('focus unavailable'));
    await expect(pip.browse()).rejects.toThrow('focus unavailable');
    expect(pip.state).toMatchObject({ expanded: true, focused: 'base' });
    expect(changed).toHaveBeenLastCalledWith(pip.state);
    await pip.focus('base');
    expect(pip.state.expanded).toBe(false);
  });

  it('does not focus the covered main app when collapsing the inset fails', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await pip.browse();
    vi.mocked(windows.activate).mockClear();
    vi.mocked(windows.move).mockRejectedValueOnce(new Error('window replaced'));
    await expect(pip.focus('base')).rejects.toThrow('window replaced');
    expect(windows.activate).not.toHaveBeenCalled();
    expect(pip.state).toMatchObject({ expanded: true, focused: 'inset' });
  });

  it('serializes stop behind an enlargement and restores original window snapshots', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    let finish!: () => void;
    vi.mocked(windows.move).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const browsing = pip.browse();
    await vi.waitFor(() => expect(windows.move).toHaveBeenCalled());
    const stopping = pip.stop();
    finish();
    await Promise.all([browsing, stopping]);
    expect(windows.restore).toHaveBeenCalledWith(snapshot('456'));
    expect(windows.restore).toHaveBeenCalledWith(snapshot('123'));
    expect(pip.state).toEqual({ active: false });
    await pip.start(base, inset, screen);
    expect(pip.state.expanded).toBe(false);
  });

  it('rejects browsing controls once the pair has stopped', async () => {
    const { windows, pip } = fixture();
    await expect(pip.browse()).rejects.toThrow('not active');
    await expect(pip.shrink()).rejects.toThrow('not active');
    expect(windows.move).not.toHaveBeenCalled();
  });

  it('focuses the chosen app explicitly, cycles all corners and three sizes', async () => {
    const { windows, pip } = fixture();
    await pip.start(base, inset, screen);
    await pip.focus('inset');
    expect(windows.activate).toHaveBeenLastCalledWith(snapshot('456'));
    await pip.focus('base');
    expect(windows.activate).toHaveBeenLastCalledWith(snapshot('123'));
    for (let i = 0; i < 4; i++) await pip.move();
    expect(pip.state.corner).toBe(0);
    for (let i = 0; i < 3; i++) await pip.resize();
    expect(pip.state.size).toBe(0);
    expect(windows.move).toHaveBeenCalledTimes(7);
  });
});

describe('inset bounds', () => {
  it('fits a short ultrawide display', () => {
    const bounds = insetBounds({ x: 0, y: 0, width: 3840, height: 1080 }, 0, 2);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThan(1080);
  });
  it('keeps all positions inside a display with a nonzero origin', () => {
    const positions = new Set<string>();
    for (let corner = 0; corner < 4; corner++) {
      for (let size = 0; size < 3; size++) {
        const bounds = insetBounds(screen, corner, size);
        expect(bounds.x).toBeGreaterThan(screen.x);
        expect(bounds.y).toBeGreaterThan(screen.y);
        expect(bounds.x + bounds.width).toBeLessThan(screen.x + screen.width);
        expect(bounds.y + bounds.height).toBeLessThan(screen.y + screen.height);
        positions.add(`${bounds.x},${bounds.y},${bounds.width}`);
      }
    }
    expect(positions.size).toBe(12);
  });
});

describe('pinned camera navigation', () => {
  const camera = { ...inset, appId: 'camera-front', camera: true };
  it('replaces the base after another app opens, retaining camera, corner and size', async () => {
    const { pip, windows } = fixture();
    await pip.start(base, camera, screen);
    await pip.move(); await pip.resize();
    await pip.opening('edge');
    await pip.opened({ appId: 'edge', name: 'Edge', windowId: '789' });
    expect(pip.state).toMatchObject({ active: true, pinned: true, baseId: 'edge', insetId: 'camera-front', corner: 1, size: 1 });
    expect(windows.inset).not.toHaveBeenCalled();
    expect(windows.restore).not.toHaveBeenCalled();
    expect(windows.raise).toHaveBeenCalledWith(camera);
    await pip.check(); // Fullscreen base is permitted.
    expect(pip.state.active).toBe(true);
  });
  it('Home re-raises without focus; Red/Close removes only the camera', async () => {
    const { pip, windows } = fixture();
    await pip.start(base, camera, screen);
    vi.mocked(windows.activate).mockClear();
    await pip.home(); await pip.focus('inset'); await pip.browse();
    expect(pip.state.active).toBe(true);
    expect(windows.activate).not.toHaveBeenCalled();
    await pip.stop(); await pip.stop();
    expect(pip.state.active).toBe(false);
    expect(windows.closePinned).toHaveBeenCalledExactlyOnceWith(camera);
    expect(windows.restore).not.toHaveBeenCalled();
  });
  it('does not depend on the original base surviving', async () => {
    const { pip, windows } = fixture();
    await pip.start(base, camera, screen);
    vi.mocked(windows.snapshot).mockImplementation(async id => { if (id === base.windowId) throw new Error('closed'); return snapshot(id); });
    await pip.closing(base.appId);
    await pip.check();
    expect(pip.state.active).toBe(true);
    expect(windows.closePinned).not.toHaveBeenCalled();
    await pip.closing(camera.appId);
    expect(pip.state.active).toBe(false);
    expect(windows.closePinned).toHaveBeenCalledOnce();
  });
  it.each(['Sofa close', 'external close', 'replaced window'])('clears the base after %s and leaves main controls idle until another app opens', async mode => {
    const { pip, windows, changed, notice } = fixture();
    await pip.start(base, camera, screen);
    const revision = pip.revision;
    if (mode === 'Sofa close') await pip.closing(base.appId);
    else {
      vi.mocked(windows.snapshot).mockImplementation(async id => {
        if (id !== base.windowId) return snapshot(id);
        if (mode === 'external close') throw new Error('closed');
        return { ...snapshot(id), ownerPid: 9999 };
      });
      await pip.check();
    }
    expect(pip.state).toMatchObject({ active: true, pinned: true, baseId: undefined });
    expect(pip.revision).toBeGreaterThan(revision);
    expect(changed).toHaveBeenLastCalledWith(pip.state);
    vi.mocked(windows.activate).mockClear();
    await pip.focus('base');
    expect(windows.activate).not.toHaveBeenCalled();
    expect(notice).toHaveBeenLastCalledWith('Main app closed; open an app to control it');
    expect(windows.closePinned).not.toHaveBeenCalled();
    await pip.opened({ appId: 'edge', name: 'Edge', windowId: '789' });
    await pip.focus('base');
    expect(windows.activate).toHaveBeenCalledExactlyOnceWith(snapshot('789'));
    expect(pip.state.baseId).toBe('edge');
  });
  it('keeps an app pair on Home and opening a member, but restores it for another app', async () => {
    const { pip, windows } = fixture();
    await pip.start(base, inset, screen);
    await pip.home(); await pip.opening(base.appId);
    expect(pip.state.active).toBe(true);
    await pip.opening('edge');
    expect(pip.state.active).toBe(false);
    expect(windows.restore).toHaveBeenCalledTimes(2);
  });
});
