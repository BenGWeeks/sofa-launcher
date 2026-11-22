import type { ResolvedApp } from './config';
import type { BackRequest } from './home-request';

/** Translate the remote Back button for the app in front. */
export function backKeyFor(app: Pick<ResolvedApp, 'type'> & Partial<Pick<ResolvedApp, 'remoteNavigation' | 'url' | 'group'>> | undefined): 'ctrl+shift+F8' | 'alt+Left' | 'Escape' {
  // A browser game: Escape is its pause or menu key; history-back would leave the game.
  if (app?.type === 'web' && app.group === 'games') return 'Escape';
  if (app?.type === 'web' && app.url) {
    const url = new URL(app.url);
    const host = url.hostname;
    const supported = ['netflix.com', 'primevideo.com'].some(domain => host.endsWith(`.${domain}`)) || ['fountain.fm', 'www.audible.co.uk', 'www.audible.com', 'listen.tidal.com', 'tidal.com'].includes(host);
    if (app.remoteNavigation && url.protocol === 'https:' && supported) return 'ctrl+shift+F8';
    if (url.origin === 'https://www.youtube.com' && /^\/tv(?:\/|$)/.test(url.pathname)) return 'Escape';
  }
  return app?.type === 'web' ? 'alt+Left' : 'Escape';
}

/**
 * Start the short title poll only after the grab has ended and Back was delivered. The app may
 * ask, in its title, for Sofa's home screen, or (YouTube's player) for a real Backspace.
 */
export async function backToWebApp(key: string, windowId: string, deps: {
  sendKeys: (key: string) => Promise<boolean>;
  watchHome: (windowId: string) => Promise<BackRequest>;
  activeWindow: () => Promise<string | null>;
  goHome: () => Promise<void>;
}): Promise<void> {
  if (!await deps.sendKeys(key)) return;
  const request = await deps.watchHome(windowId);
  if (!request || await deps.activeWindow() !== windowId) return;
  if (request === 'home') return deps.goHome();
  // YouTube's player: a real Backspace. With its controls hidden the first only shows them; the
  // page then asks once more, and one more is all this ever sends for one Back.
  if (!await deps.sendKeys('BackSpace')) return;
  if (await deps.watchHome(windowId) === 'backspace' && await deps.activeWindow() === windowId) await deps.sendKeys('BackSpace');
}
