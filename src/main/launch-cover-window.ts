import { BrowserWindow, screen } from 'electron';
import type { WindowManager } from './windows';

/** Optional notification-layer cover: Home remains usable if X11 setup fails. */
export async function prepareLaunchCover(
  wm: Pick<WindowManager, 'setType'>,
  lockDown: (window: BrowserWindow) => void,
): Promise<BrowserWindow | null> {
  let window: BrowserWindow | null = null;
  try {
    const bounds = screen.getPrimaryDisplay().bounds;
    window = new BrowserWindow({
      ...bounds, minWidth: bounds.width, minHeight: bounds.height,
      show: false, frame: false, fullscreen: true, backgroundColor: '#000000',
      skipTaskbar: true,
      resizable: false, movable: false, hasShadow: false,
      alwaysOnTop: true,
      title: 'Sofa Launch Cover',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    lockDown(window);
    window.setIgnoreMouseEvents(true);
    // Native notification windows are override-redirect and shrink by a pixel on X11.
    await wm.setType?.(String(window.getNativeWindowHandle().readUInt32LE(0)), 'notification');
    // backgroundColor paints the empty window; no renderer document is needed.
    return window;
  } catch (error) {
    console.error('Launch cover unavailable; continuing with Home:', error);
    window?.destroy();
    return null;
  }
}
