import { BROWSER_IDS, type BrowserChoice } from '../shared/browsers';
import { z } from 'zod';
import { parse as parseToml } from 'smol-toml';
import { isAllowedWebUrl } from './web-url';
import { CATALOGUE } from './catalogue';
import type { AppType, Background, GlobalAction, Theme } from '@shared/types';
import { BACKGROUND_IDS, DEFAULT_BACKGROUND } from '@shared/backgrounds';

const appId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'lowercase letters, digits and dashes');
const webUrl = z.url().refine(isAllowedWebUrl, 'HTTPS required except HTTP on loopback or LAN hosts');
/** Accelerator like "Ctrl+Alt+Shift+H" or "MediaPlayPause"; validated loosely, Electron rejects bad ones. */
const accelerator = z.string().regex(/^[A-Za-z0-9+]+$/);

const AppSchema = z
  .object({
    id: appId,
    catalogue: z.string().optional(),
    name: z.string().min(1).max(40).optional(),
    type: z.enum(['web', 'desktop']).optional(),
    url: webUrl.optional(),
    browser: z.enum(['default', ...BROWSER_IDS]).optional(),
    userAgent: z.string().max(300).optional(),
    remoteNavigation: z.boolean().optional(),
    searchUrl: webUrl.optional(),
    command: z.array(z.string().min(1)).min(1).optional(),
    wmClass: z.string().regex(/^[A-Za-z0-9._-]+$/).optional(),
    hotkeys: z.record(z.string(), z.string().regex(/^[a-zA-Z0-9+_]+$/)).optional(),
    hidden: z.boolean().optional(),
    flatpak: z.string().regex(/^[A-Za-z0-9_.-]+$/).optional(),
    keepOnClose: z.boolean().optional(),
    /** "games" puts the tile in the Games row (no 1-9 number); "apps" moves a catalogue game back. */
    group: z.enum(['apps', 'games']).optional(),
  })
  .strict();

/** An absolute, normalised file path ("/var/lib/docker-status/containers.json"). */
const statusFile = z.string().max(1024).refine(
  (p) => p.startsWith('/') && !/[\0\n\r]/.test(p) && !p.split('/').some((part) => part === '.' || part === '..'),
  'an absolute path to the status file',
);

/** Steam app ids, as "552990" or 552990. */
const steamAppId = z.union([z.string().regex(/^\d{1,10}$/), z.number().int().nonnegative().max(9_999_999_999)]).transform(String);

const ButtonsSchema = z
  .object({
    back: accelerator,
    home: accelerator,
    power: accelerator,
    cameraToggle: accelerator,
    cameraNext: accelerator,
    cameraCorner: accelerator,
    blue: accelerator,
    nodieTalk: accelerator,
    info: accelerator,
    menu: accelerator,
    input: accelerator,
    spareE: accelerator,
  })
  .partial()
  .strict();

const ConfigSchema = z
  .object({
    ui: z
      .object({
        browser: z.enum(['default', ...BROWSER_IDS]).optional(),
        defaultBrowser: z.enum(['edge']).optional(),
        theme: z.enum(['knowall', 'nodie']).default('knowall'),
        background: z.enum(BACKGROUND_IDS).default(DEFAULT_BACKGROUND),
      })
      .strict()
      .transform(({ browser, defaultBrowser, ...ui }) => ({ ...ui, browser: browser ?? defaultBrowser ?? 'default' }))
      .default({ browser: 'default', theme: 'knowall', background: DEFAULT_BACKGROUND }),
    apps: z.array(AppSchema).default([]),
    homeAssistant: z.object({ url: webUrl }).strict().optional(),
    cameras: z.array(z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/),
      name: z.string().min(1).max(40),
      entity: z.string().regex(/^camera\.[a-z0-9_]+$/),
    }).strict()).max(32).default([]),
    buttons: ButtonsSchema.default({}),
    /** Docker tile: a JSON status file (written by a system service), never the Docker socket. */
    containers: z.object({ file: statusFile }).strict().optional(),
    games: z
      .object({
        enabled: z.boolean().default(true),
        hidden: z.array(steamAppId).max(1000).default([]),
        /** Download missing header artwork from Steam's public image server. */
        fetchArt: z.boolean().default(true),
      })
      .strict()
      .default({ enabled: true, hidden: [], fetchArt: true }),
  })
  .strict();

export type RawConfig = z.infer<typeof ConfigSchema>;

/** Default remote mapping; see docs/keymap.md. */
export const DEFAULT_BUTTONS: Record<GlobalAction, string> = {
  back: 'Ctrl+Alt+Shift+K',
  home: 'Ctrl+Alt+Shift+H',
  power: 'Ctrl+Alt+Shift+P',
  cameraToggle: 'Ctrl+Alt+Shift+R',
  cameraNext: 'Ctrl+Alt+Shift+G',
  cameraCorner: 'Ctrl+Alt+Shift+Y',
  blue: 'Ctrl+Alt+Shift+B',
  nodieTalk: 'Ctrl+Alt+Shift+N',
  info: 'Ctrl+Alt+Shift+I',
  menu: 'Ctrl+Alt+Shift+M',
  input: 'Ctrl+Alt+Shift+S',
  spareE: 'Ctrl+Alt+Shift+E',
};

/** A fully resolved app: catalogue defaults merged with config overrides. */
export interface ResolvedApp {
  id: string;
  name: string;
  type: AppType;
  entity?: string;
  url?: string;
  userAgent?: string;
  remoteNavigation?: boolean;
  /** Search URL prefix (catalogue `search` or config `searchUrl`); the encoded query is appended. */
  searchUrl?: string;
  command?: string[];
  flatpak?: string;
  keepOnClose?: boolean;
  wmClass: string;
  brand?: string;
  image?: string;
  hotkeys: Record<string, string>;
  /** "games": shown in the home screen's Games row, without a 1-9 number. */
  group?: 'games';
  /** The command only asks another program (the Steam client) to start the app: never signal it. */
  handOff?: boolean;
  /** Local artwork file (detected Steam games). */
  art?: string;
  /** The full browser (tabs and address bar) rather than one site in app mode. */
  fullBrowser?: boolean;
  browser?: BrowserChoice;
}

export interface GamesConfig {
  /** Show installed Steam games in the Games row. */
  enabled: boolean;
  /** Steam app ids never to show. */
  hidden: string[];
  /** Fetch missing game artwork from Steam's public image server (only the game's Steam number is sent). */
  fetchArt: boolean;
}

export interface UiConfig {
  browser: BrowserChoice;
  theme: Theme;
  background: Background;
}

export interface Config {
  ui: UiConfig;
  apps: ResolvedApp[];
  buttons: Record<GlobalAction, string>;
  homeAssistantUrl?: string;
  games: GamesConfig;
  /** The containers status file ([containers] file), if set up. */
  containersFile?: string;
  /**
   * Every app entry of config.toml that resolves (cameras excluded), in file order, including
   * `hidden = true` ones (which are not in `apps`), so Edit home screen can switch them back on.
   */
  configuredApps: { app: ResolvedApp; hidden: boolean }[];
  /** Catalogue entries referenced by config.toml (by `catalogue = ...`). */
  usedCatalogue: string[];
}

export class ConfigError extends Error {}

export function parseConfig(toml: string): Config {
  let data: unknown;
  try {
    data = parseToml(toml);
  } catch (e) {
    throw new ConfigError(`config.toml is not valid TOML: ${(e as Error).message}`);
  }
  const result = ConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`config.toml is invalid: ${issues}`);
  }
  return resolve(result.data);
}

type RawApp = RawConfig['apps'][number];

/** Merge one config entry with its catalogue entry. Throws ConfigError if it can't be used. */
function resolveApp(a: RawApp): ResolvedApp {
  const base = a.catalogue ? CATALOGUE[a.catalogue] : undefined;
  if (a.catalogue && !base) throw new ConfigError(`app "${a.id}": unknown catalogue entry "${a.catalogue}"`);
  const type = a.type ?? base?.type;
  if (!type) throw new ConfigError(`app "${a.id}": needs a type ("web" or "desktop") or a catalogue entry`);
  const merged: ResolvedApp = {
    id: a.id,
    name: a.name ?? base?.name ?? a.id,
    type,
    url: a.url ?? base?.url,
    browser: a.browser,
    userAgent: a.userAgent ?? base?.userAgent,
    remoteNavigation: a.remoteNavigation ?? base?.remoteNavigation,
    searchUrl: a.searchUrl ?? base?.search,
    command: a.command ?? base?.command,
    flatpak: a.flatpak ?? base?.flatpak,
    keepOnClose: a.keepOnClose ?? base?.keepOnClose,
    wmClass: a.wmClass ?? base?.wmClass ?? `sofa-${a.id}`,
    brand: base?.brand,
    image: base?.image,
    hotkeys: { ...base?.hotkeys, ...a.hotkeys },
  };
  if ((a.group ?? base?.group) === 'games') merged.group = 'games';
  if (base?.fullBrowser && type === 'web') merged.fullBrowser = true;
  if (type === 'web' && !merged.url && !merged.fullBrowser) throw new ConfigError(`app "${a.id}": web apps need a url`);
  if (type === 'web' && merged.url && !isAllowedWebUrl(merged.url))
    throw new ConfigError(`app "${a.id}": url must be HTTPS or loopback/LAN HTTP`);
  if (type === 'desktop' && !merged.command) throw new ConfigError(`app "${a.id}": desktop apps need a command`);
  return merged;
}

/** A catalogue entry on its own, as if config.toml listed `catalogue = "<id>"`; null if it needs settings first (a URL). */
export function resolveCatalogueApp(id: string): ResolvedApp | null {
  if (!CATALOGUE[id] || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return null;
  try { return resolveApp({ id, catalogue: id }); } catch { return null; }
}

function resolve(raw: RawConfig): Config {
  const seen = new Set<string>();
  const apps: ResolvedApp[] = [];
  const configuredApps: Config['configuredApps'] = [];
  for (const a of raw.apps) {
    if (seen.has(a.id)) throw new ConfigError(`config.toml: duplicate app id "${a.id}"`);
    seen.add(a.id);
    if (a.hidden) {
      // Hidden entries were never validated: one that doesn't resolve simply stays hidden.
      try { configuredApps.push({ app: resolveApp(a), hidden: true }); } catch { /* stays hidden */ }
      continue;
    }
    const merged = resolveApp(a);
    configuredApps.push({ app: merged, hidden: false });
    apps.push(merged);
  }
  const homeAssistantUrl = raw.homeAssistant?.url ?? apps.find(app => app.id === 'homeassistant')?.url;
  if (raw.cameras.length && !homeAssistantUrl) throw new ConfigError('Camera inputs need a Home Assistant URL');
  const cameraEntities = new Set<string>();
  for (const camera of raw.cameras) {
    const id = `camera-${camera.id}`;
    if (seen.has(id) || cameraEntities.has(camera.entity)) throw new ConfigError('Duplicate camera input');
    seen.add(id); cameraEntities.add(camera.entity);
    apps.push({ id, name: camera.name, type: 'camera', entity: camera.entity, wmClass: `sofa-${id}`, brand: 'camera', hotkeys: {} });
  }
  if (raw.cameras.length) {
    if (seen.has('all-cameras')) throw new ConfigError('The app id all-cameras is reserved for the camera grid');
    apps.splice(apps.length - raw.cameras.length, 0, { id: 'all-cameras', name: 'All cameras', type: 'camera', entity: 'all', wmClass: 'sofa-all-cameras', brand: 'camera', hotkeys: {} });
  }
  const usedCatalogue = [...new Set(raw.apps.flatMap((a) => (a.catalogue ? [a.catalogue] : [])))];
  return { ui: raw.ui, apps, homeAssistantUrl, buttons: { ...DEFAULT_BUTTONS, ...raw.buttons }, games: raw.games, configuredApps, usedCatalogue, containersFile: raw.containers?.file };
}

/** Written to ~/.config/sofa-launcher/config.toml on first run (never overwritten). */
export const SEED_CONFIG = `# Sofa Launcher configuration. Tiles appear in this order (1-9 on the remote).
# Catalogue apps: netflix, prime, youtube, disney, iplayer, spotify, tidal, audible, fountain, homeassistant, jellyfin, jellyseerr, nodie, roblox, edge, docker
# Any field can be overridden; set hidden = true to hide a tile.
# Menu → Edit home screen shows or hides apps, games and cameras without editing this file:
# those choices are kept in home.json next to it, and win over hidden = true here.
# group = "games" puts an app in the Games row (no 1-9 number). Roblox (via the Sober Flatpak) is a game already:
#   [[apps]]
#   id = "roblox"
#   catalogue = "roblox"

[ui]
browser = "default"
# Appearance: "knowall" (luminous green) or "nodie" (Bitcoin orange).
theme = "knowall"
# Home background: midnight, corner-glow, horizon-glow, brand-wash, dot-grid, near-black,
# horizon, ribbons, smoke-left, smoke-right, nebula or planet (Menu → Background).
background = "midnight"

[[apps]]
id = "jellyfin"
catalogue = "jellyfin"

# Jellyseerr on this PC; change the address if it runs elsewhere on your network
[[apps]]
id = "jellyseerr"
catalogue = "jellyseerr"
url = "http://127.0.0.1:5055"

[[apps]]
id = "netflix"
catalogue = "netflix"

[[apps]]
id = "prime"
catalogue = "prime"

[[apps]]
id = "youtube"
catalogue = "youtube"

[[apps]]
id = "homeassistant"
catalogue = "homeassistant"
# Change to your Home Assistant address, e.g. http://192.168.1.50:8123 or https://ha.example.com
url = "http://homeassistant.local:8123"

[[apps]]
id = "nodie"
catalogue = "nodie"

[[apps]]
id = "audible"
catalogue = "audible"

[[apps]]
id = "fountain"
catalogue = "fountain"

[[apps]]
id = "tidal"
catalogue = "tidal"

# Installed Steam games of this login appear in the Games row after the games above.
# [games]
# enabled = true          # false hides Steam games
# hidden = ["552990"]     # Steam app ids to leave out
# fetchArt = true         # download each game's official picture from Steam (sends only the game's Steam number)

# The Docker tile shows container status from a read-only JSON file (see README):
#   [[apps]]
#   id = "docker"
#   catalogue = "docker"
#   [containers]
#   file = "/var/lib/docker-status/containers.json"

# Remote buttons (see docs/keymap.md). Defaults shown; uncomment to change.
[buttons]
# home = "Ctrl+Alt+Shift+H"
# power = "Ctrl+Alt+Shift+P"
`;
