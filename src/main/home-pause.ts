import type { PipState } from '@shared/types';

/**
 * The apps to pause when Home takes over the screen: the app that was in front, or
 * both apps of a screen-in-screen pair (Home covers them and they keep running).
 * Nod.ie is left alone: Home must not cut the assistant off mid-reply.
 * Games are skipped later, by AppManager.pause.
 */
export function appsLeftForHome(pip: PipState, lastAppId: string | null): string[] {
  const ids = pip.active && !pip.pinned ? [pip.baseId, pip.insetId] : [lastAppId];
  return [...new Set(ids.filter((id): id is string => !!id && id !== 'nodie'))];
}
