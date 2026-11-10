import type { Bounds, PipWindow } from './pip';

interface ScreenCoordinates {
  screenToDipPoint(point: { x: number; y: number }): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): { scaleFactor: number };
}

/** X11 uses physical pixels; Electron window bounds use DIP. No Windows-only APIs. */
export function cameraDipBounds(screen: ScreenCoordinates, bounds: Bounds): Bounds {
  const origin = screen.screenToDipPoint({ x: bounds.x, y: bounds.y });
  const { scaleFactor } = screen.getDisplayNearestPoint(origin);
  return { ...origin, width: Math.round(bounds.width / scaleFactor), height: Math.round(bounds.height / scaleFactor) };
}

/** Shared by the main process and the native Electron regression smoke. */
export async function pinCamera(
  inputs: { pin(appId: string, bounds: Bounds, deferVisibility?: boolean): void; raise(appId: string): void },
  windows: { preparePinned(id: string, bounds: Bounds): Promise<void>; keepAbove(id: string): Promise<void> },
  screen: ScreenCoordinates, window: PipWindow, bounds: Bounds,
): Promise<void> {
  // Electron must leave fullscreen before X11 finalizes decorations/geometry.
  // Keep the viewer mapped until EWMH requests finish, then apply suppression.
  inputs.pin(window.appId, cameraDipBounds(screen, bounds), true);
  try {
    await windows.preparePinned(window.windowId, bounds);
    await windows.keepAbove(window.windowId);
  } finally { inputs.raise(window.appId); }
}
