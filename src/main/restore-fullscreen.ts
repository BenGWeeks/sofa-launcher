import type { PipState } from '@shared/types';
import type { ResolvedApp } from './config';
import { requiresFullscreen } from './launch-cover';
import type { WindowManager } from './windows';

/**
 * Opening an app must leave it full screen, even when something took it out since it
 * started: a mouse on the browser's exit-full-screen button, F11 or Esc on a keyboard,
 * or the title-bar buttons that appear afterwards. Without this the app comes back at
 * whatever size it was left, which can be a sliver nobody can see.
 *
 * Screen-in-screen sizes its two windows on purpose, so that pair is left alone.
 * Returns true when a window was put back.
 */
export async function restoreFullscreen(
  app: ResolvedApp,
  wm: Pick<WindowManager, 'findByClass' | 'isFullscreen' | 'setFullscreen'>,
  pip: PipState,
): Promise<boolean> {
  if (!wm.isFullscreen || !wm.setFullscreen || !requiresFullscreen(app)) return false;
  if (pip.active && !pip.pinned && [pip.baseId, pip.insetId].includes(app.id)) return false;
  try {
    const window = (await wm.findByClass(app.wmClass)).at(-1);
    if (!window || await wm.isFullscreen(window)) return false;
    await wm.setFullscreen(window);
    return true;
  } catch {
    return false; // best effort: the app is open either way
  }
}
