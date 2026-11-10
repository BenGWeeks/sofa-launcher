/** Which UI a renderer window shows, from its URL hash: "#home", "#panel", "#toast" (+ "?demo=..."). */
export type Route = 'home' | 'panel' | 'toast' | 'camera';

export interface ParsedRoute {
  route: Route;
  /** Demo data to seed (screenshots): e.g. "button-test" or "1". */
  demo: string | null;
}

export function parseRoute(hash: string): ParsedRoute {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const route: Route = path === 'panel' || path === 'toast' || path === 'camera' ? path : 'home';
  return { route, demo: new URLSearchParams(query).get('demo') };
}
