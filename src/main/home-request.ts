/** Prefix a Sofa web app puts on its window title when Back has nowhere left to go. */
export const HOME_REQUEST_MARKER = '[sofa:home]';
/** Prefix YouTube's TV page puts on its title when Back must be a real Backspace (in its player). */
export const BACKSPACE_REQUEST_MARKER = '[sofa:backspace]';

/** What a web app asked for after Back: Sofa's home screen, a real Backspace, or nothing. */
export type BackRequest = 'home' | 'backspace' | null;

/**
 * After Back is sent to a web app, watch its window title briefly. Resolves 'home' if the app
 * asked for the launcher's home screen, 'backspace' if it asked for a real Backspace, else null.
 * A newer watch cancels an older one.
 */
export function homeRequestWatcher(deps: {
  title: (windowId: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  intervalMs?: number;
}): (windowId: string) => Promise<BackRequest> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.attempts ?? 8;
  const intervalMs = deps.intervalMs ?? 90;
  let generation = 0;
  return async (windowId) => {
    const mine = ++generation;
    for (let i = 0; i < attempts; i++) {
      await sleep(intervalMs);
      if (mine !== generation) return null;
      const title = await deps.title(windowId).catch(() => '');
      if (mine !== generation) return null;
      if (title.includes(HOME_REQUEST_MARKER)) return 'home';
      if (title.includes(BACKSPACE_REQUEST_MARKER)) return 'backspace';
    }
    return null;
  };
}
