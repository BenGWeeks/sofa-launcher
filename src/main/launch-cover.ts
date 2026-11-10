import type { ResolvedApp } from './config';

/** The full browser keeps its toolbar; desktop apps only promise fullscreen when requested. */
export function requiresFullscreen(app: ResolvedApp): boolean {
  if (app.type === 'web') return !app.fullBrowser;
  if (app.type === 'camera') return true;
  return app.type === 'desktop' && !!app.command?.some(arg =>
    ['--fullscreen', '--start-fullscreen', '-fullscreen'].includes(arg));
}

export function launchCoverTimeout(app: Pick<ResolvedApp, 'type'>): number {
  return app.type === 'web' || app.type === 'camera' ? 8000 : 4000;
}

/** Keep a mapped cover above the panel until the selected app is ready.
 * Discovery runs alongside opening; the deadline also bounds hung X11 probes.
 */
export function launchCover(deps: {
  setAbove: (above: boolean) => void;
  activeWindow: () => Promise<string | null>;
  ownWindows?: () => string[];
  isFullscreen: (windowId: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let generation = 0;
  const cancel = () => { generation++; deps.setAbove(false); };
  async function release(mine: number, targetWindows: () => Promise<string[]>, fullscreen: boolean, timeoutMs: number): Promise<void> {
    // A real timer bounds slow X11 probes too, rather than counting poll iterations.
    const timer = setTimeout(() => { if (mine === generation) cancel(); }, deps.timeoutMs ?? timeoutMs);
    try {
      while (mine === generation) {
        const active = await deps.activeWindow().catch(() => null);
        if (mine !== generation) return;
        if (active && !deps.ownWindows?.().includes(active)) {
          const full = await deps.isFullscreen(active).catch(() => false);
          if (mine !== generation) return;
          if (full) break;
          if (!fullscreen) {
            const windows = await targetWindows().catch((): string[] => []);
            if (mine !== generation) return;
            if (windows.includes(active)) break;
          }
        }
        if (mine === generation) await sleep(deps.intervalMs ?? 100);
      }
      if (mine === generation) cancel();
    } finally { clearTimeout(timer); }
  }
  const cover = async <T>(open: () => Promise<T>, targetWindows: () => Promise<string[]>, fullscreen = true, timeoutMs = 8000): Promise<T> => {
    const mine = ++generation;
    deps.setAbove(true);
    void release(mine, targetWindows, fullscreen, timeoutMs);
    try {
      const result = await open();
      if (mine === generation && result && typeof result === 'object' && 'ok' in result && result.ok === false) cancel();
      return result;
    }
    catch (error) { if (mine === generation) cancel(); throw error; }
  };
  cover.cancel = cancel;
  return cover;
}

/** KWin notification covers sit above keep-above toasts. Hide before showing queued messages. */
export function coverToastGate(setAbove: (above: boolean) => void, showToast: (text: string) => void) {
  let covered = false;
  const pending: string[] = [];
  return {
    setAbove(above: boolean) {
      covered = above;
      setAbove(above);
      if (!above) for (const text of pending.splice(0)) showToast(text);
    },
    toast(text: string) {
      if (covered) pending.push(text);
      else showToast(text);
    },
  };
}
