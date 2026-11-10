/** Prefix a Sofa web app puts on its window title when Back has nowhere left to go. */
export const HOME_REQUEST_MARKER = '[sofa:home]';

/**
 * After Back is sent to a web app, watch its window title briefly. Resolves true if
 * the app asked for the launcher's home screen. A newer watch cancels an older one.
 */
export function homeRequestWatcher(deps: {
  title: (windowId: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  intervalMs?: number;
}): (windowId: string) => Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.attempts ?? 8;
  const intervalMs = deps.intervalMs ?? 90;
  let generation = 0;
  return async (windowId) => {
    const mine = ++generation;
    for (let i = 0; i < attempts; i++) {
      await sleep(intervalMs);
      if (mine !== generation) return false;
      const title = await deps.title(windowId).catch(() => '');
      if (mine !== generation) return false;
      if (title.includes(HOME_REQUEST_MARKER)) return true;
    }
    return false;
  };
}
