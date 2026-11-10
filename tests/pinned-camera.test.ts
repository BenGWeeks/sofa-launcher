import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cameraDipBounds, pinCamera } from '../src/main/pinned-camera';

describe('real camera pin wiring', () => {
  it.each([1, 2])('converts X11 geometry to DIP at scale %s without Windows APIs', async scaleFactor => {
    const screen = {
      screenToDipPoint: vi.fn(({ x, y }) => ({ x: x / scaleFactor, y: y / scaleFactor })),
      getDisplayNearestPoint: vi.fn(() => ({ scaleFactor })),
      get screenToDipRect(): never { throw new Error('Windows-only API called'); },
    };
    const bounds = { x: 120, y: 240, width: 640, height: 360 };
    const inputs = { pin: vi.fn(), raise: vi.fn() };
    const windows = { preparePinned: vi.fn(async () => {}), keepAbove: vi.fn(async () => {}) };
    await pinCamera(inputs, windows, screen, { appId: 'camera', name: 'Camera', windowId: '42' }, bounds);
    expect(inputs.pin).toHaveBeenCalledWith('camera', { x: 120 / scaleFactor, y: 240 / scaleFactor, width: 640 / scaleFactor, height: 360 / scaleFactor }, true);
    expect(windows.preparePinned).toHaveBeenCalledWith('42', bounds);
    expect(windows.keepAbove).toHaveBeenCalledWith('42');
    expect(inputs.raise).toHaveBeenCalledExactlyOnceWith('camera');
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 120 / scaleFactor, y: 240 / scaleFactor });
  });
  it('applies overlay suppression even when X11 preparation fails', async () => {
    const inputs = { pin: vi.fn(), raise: vi.fn() };
    const windows = { preparePinned: vi.fn(async () => { throw new Error('closed'); }), keepAbove: vi.fn() };
    const screen = { screenToDipPoint: (point: { x: number; y: number }) => point, getDisplayNearestPoint: () => ({ scaleFactor: 1 }) };
    await expect(pinCamera(inputs, windows, screen, { appId: 'camera', name: 'Camera', windowId: '42' }, { x: 0, y: 0, width: 320, height: 180 })).rejects.toThrow('closed');
    expect(inputs.raise).toHaveBeenCalledExactlyOnceWith('camera');
    expect(windows.keepAbove).not.toHaveBeenCalled();
  });
  it('preserves negative display origins and rounds dimensions', () => {
    const screen = { screenToDipPoint: () => ({ x: -1000, y: 50 }), getDisplayNearestPoint: () => ({ scaleFactor: 1.5 }) };
    expect(cameraDipBounds(screen, { x: -1500, y: 75, width: 601, height: 337 })).toEqual({ x: -1000, y: 50, width: 401, height: 225 });
  });
  it('uses the tested pin adapter in main and the native Electron smoke', () => {
    const main = readFileSync('src/main/index.ts', 'utf8');
    expect(main).toContain('await pinCamera(cameraInputs, x11Pip, screen, window, bounds)');
    expect(main).not.toContain('screenToDipRect');
    expect(readFileSync('tests/pinned-inset.electron.cjs', 'utf8')).toContain('await pinCamera(cameras, x11, screen, w, b)');
  });
});
