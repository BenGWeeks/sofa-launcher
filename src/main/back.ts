import type { ResolvedApp } from './config';

/** Translate the remote Back button for the app in front. */
export function backKeyFor(app: Pick<ResolvedApp, 'type'> & Partial<Pick<ResolvedApp, 'remoteNavigation' | 'url'>> | undefined): 'ctrl+shift+F8' | 'alt+Left' | 'Escape' {
  if (app?.type === 'web' && app.url) {
    const url = new URL(app.url);
    const host = url.hostname;
    const supported = ['netflix.com', 'primevideo.com'].some(domain => host.endsWith(`.${domain}`)) || ['fountain.fm', 'www.audible.co.uk', 'www.audible.com', 'listen.tidal.com', 'tidal.com'].includes(host);
    if (app.remoteNavigation && url.protocol === 'https:' && supported) return 'ctrl+shift+F8';
    if (url.origin === 'https://www.youtube.com' && /^\/tv(?:\/|$)/.test(url.pathname)) return 'Escape';
  }
  return app?.type === 'web' ? 'alt+Left' : 'Escape';
}

/** Start the short title poll only after the grab has ended and Back was delivered. */
export async function backToWebApp(key: string, windowId: string, deps: {
  sendKeys: (key: string) => Promise<boolean>;
  watchHome: (windowId: string) => Promise<boolean>;
  activeWindow: () => Promise<string | null>;
  goHome: () => Promise<void>;
}): Promise<void> {
  if (!await deps.sendKeys(key)) return;
  if (await deps.watchHome(windowId) && await deps.activeWindow() === windowId) await deps.goHome();
}
