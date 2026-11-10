/**
 * Pure decisions for the Home / Menu / Info buttons, so they can be unit-tested
 * without Electron. The main process reads its window state and asks here.
 */
import type { ActionContext } from '@shared/types';

export interface LauncherState {
  /** The full launcher window is visible and focused. */
  launcherInFront: boolean;
  panelOpen: boolean;
}

/** Home always leaves overlays and returns to the full home screen. */
export function decideHome(_s: LauncherState): 'show-home' {
  return 'show-home';
}

export function decideMenu(s: LauncherState): 'close-panel' | 'open-panel' | 'settings' {
  if (s.panelOpen) return 'close-panel';
  return s.launcherInFront ? 'settings' : 'open-panel';
}

/** Which context the remote guide should describe. */
export function contextFor(s: Pick<LauncherState, 'launcherInFront' | 'panelOpen'>): ActionContext {
  if (s.panelOpen) return 'panel';
  return s.launcherInFront ? 'home' : 'app';
}
