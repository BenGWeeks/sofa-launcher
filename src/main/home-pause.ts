import type { PipState } from '@shared/types';

/**
 * The apps to pause when Home takes over the screen: the app that was in front, both
 * apps of a screen-in-screen pair (Home covers them and they keep running), or the
 * main app under a pinned camera.
 * Nod.ie is left alone: Home must not cut the assistant off mid-reply.
 * Games are skipped later, by AppManager.pause.
 */
export function appsLeftForHome(pip: PipState, lastAppId: string | null): string[] {
  // Under a pinned camera the last app opened is the camera itself: pause the main app.
  const ids = !pip.active ? [lastAppId] : pip.pinned ? [pip.baseId] : [pip.baseId, pip.insetId];
  return [...new Set(ids.filter((id): id is string => !!id && id !== 'nodie'))];
}
