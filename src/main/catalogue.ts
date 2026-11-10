/**
 * Built-in app catalogue. Config entries reference these by `catalogue = "<id>"`
 * and may override any field. User-specific values (e.g. a Home Assistant URL)
 * are deliberately absent here and come from config.
 */
export interface CatalogueEntry {
  name: string;
  type: 'web' | 'desktop' | 'containers';
  url?: string;
  command?: string[];
  flatpak?: string;
  keepOnClose?: boolean;
  wmClass?: string;
  userAgent?: string;
  remoteNavigation?: boolean;
  /** URL prefix for a search; the encoded text is appended (`sofa-launcher open <id> --search`). */
  search?: string;
  brand?: string;
  image?: string;
  hotkeys?: Record<string, string>;
  /** "games": the Games row on the home screen. */
  group?: 'games';
  /** Opens the whole browser (tabs, address bar) instead of one site in app mode. */
  fullBrowser?: boolean;
}

/** A TV user agent so youtube.com/tv serves the 10-foot UI. */
export const YOUTUBE_TV_UA =
  'Mozilla/5.0 (Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';

export const CATALOGUE: Record<string, CatalogueEntry> = {
  netflix: {
    name: 'Netflix', type: 'web', url: 'https://www.netflix.com/browse', remoteNavigation: true,
    search: 'https://www.netflix.com/search?q=', brand: 'netflix',
    hotkeys: { subtitles: 'ctrl+shift+F9' },
  },
  prime: {
    name: 'Prime Video', type: 'web', url: 'https://www.primevideo.com/', remoteNavigation: true,
    search: 'https://www.primevideo.com/search?phrase=', brand: 'prime',
    hotkeys: { subtitles: 'c' },
  },
  youtube: {
    name: 'YouTube',
    type: 'web',
    url: 'https://www.youtube.com/tv',
    userAgent: YOUTUBE_TV_UA,
    search: 'https://www.youtube.com/tv#/search?q=',
    brand: 'youtube',
    hotkeys: { subtitles: 'c' },
  },
  disney: { name: 'Disney+', type: 'web', url: 'https://www.disneyplus.com/', brand: 'disney' },
  iplayer: { name: 'BBC iPlayer', type: 'web', url: 'https://www.bbc.co.uk/iplayer', brand: 'iplayer' },
  spotify: { name: 'Spotify', type: 'web', url: 'https://open.spotify.com/', brand: 'spotify' },
  tidal: { name: 'TIDAL', type: 'web', url: 'https://listen.tidal.com/', brand: 'tidal', remoteNavigation: true },
  audible: { name: 'Audible', type: 'web', url: 'https://www.audible.co.uk/library', brand: 'audible', remoteNavigation: true },
  fountain: { name: 'Fountain', type: 'web', url: 'https://fountain.fm/feed', brand: 'fountain', remoteNavigation: true },
  homeassistant: { name: 'Home Assistant', type: 'web', brand: 'homeassistant' },
  jellyfin: {
    name: 'Jellyfin',
    type: 'desktop',
    command: [
      'flatpak', 'run', '--branch=stable', '--arch=x86_64',
      '--command=jellyfin-desktop', 'org.jellyfin.JellyfinDesktop', '--tv', '--fullscreen',
    ],
    flatpak: 'org.jellyfin.JellyfinDesktop',
    wmClass: 'jellyfin-desktop',
    brand: 'jellyfin',
    hotkeys: { subtitles: 's' },
  },
  jellyseerr: { name: 'Jellyseerr', type: 'web', brand: 'jellyseerr' },
  // General browsing: the full browser in its own Sofa profile, starting on the browser's new-tab page.
  edge: { name: 'Microsoft Edge', type: 'web', fullBrowser: true, brand: 'edge' },
  roblox: {
    // Roblox runs on Linux through the Sober Flatpak.
    name: 'Roblox',
    type: 'desktop',
    command: ['flatpak', 'run', 'org.vinegarhq.Sober'],
    flatpak: 'org.vinegarhq.Sober',
    // Assumed window class: confirm on the TV with `xprop WM_CLASS` while Sober is open.
    wmClass: 'sober',
    brand: 'roblox',
    group: 'games',
  },
  // The launcher's own containers view; needs a [containers] table in config.toml.
  docker: { name: 'Docker', type: 'containers', brand: 'docker' },
  nodie: {
    name: 'Nodie',
    type: 'desktop',
    command: ['~/.local/bin/nodie-desktop', '--tv'],
    wmClass: 'nodie',
    image: 'nodie',
    hotkeys: { talk: 'ctrl+shift+space', camera: 'ctrl+shift+c', mic: 'ctrl+shift+m', speaker: 'ctrl+shift+s' },
  },
};
