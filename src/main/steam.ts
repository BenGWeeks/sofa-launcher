/**
 * Installed Steam games for the logged-in user, read from their own Steam files
 * (so each account sees its own games). Pure file reads; no Steam client calls.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedApp } from './config';

/**
 * Steam's own tools, which appear as installed "apps" but are not games:
 * 228980 Steamworks Common Redistributables, 1070560 Steam Linux Runtime 1.0 (scout),
 * 1391110 Steam Linux Runtime 2.0 (soldier), 1628350 Steam Linux Runtime 3.0 (sniper),
 * 1493710 Proton Experimental, 2180100 Proton Hotfix, 961940 Proton 3.16 (Beta),
 * 1826330 Proton EasyAntiCheat Runtime. Names starting with STEAM_TOOL_PREFIXES are excluded too.
 */
export const STEAM_TOOL_APP_IDS: ReadonlySet<string> = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '961940', '1826330']);
export const STEAM_TOOL_PREFIXES = ['Proton', 'Steam Linux Runtime', 'Steamworks'];

/** StateFlags bit 4: the game is fully installed. */
const FULLY_INSTALLED = 4;

export interface SteamGame {
  appId: string;
  name: string;
  lastPlayed: number;
  /** Local artwork file, if Steam has cached one. */
  art?: string;
}

export interface VdfObject { [key: string]: string | VdfObject }

/**
 * Valve KeyValues text (.vdf / .acf). Keys are lower-cased; for a repeated key the
 * last value wins. Handles quoted and bare tokens, escapes, // comments and
 * skips [$PLATFORM] conditionals.
 */
export function parseVdf(text: string): VdfObject {
  const tokens: { value: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}') { tokens.push({ value: c, quoted: false }); i++; continue; }
    if (c === '[') { const end = text.indexOf(']', i); i = end < 0 ? text.length : end + 1; continue; }
    if (c === '"') {
      let value = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1]!;
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else value += text[i++];
      }
      i++;
      tokens.push({ value, quoted: true });
      continue;
    }
    let value = '';
    while (i < text.length && !/[\s{}"]/.test(text[i]!)) value += text[i++];
    tokens.push({ value, quoted: false });
  }
  let p = 0;
  const block = (): VdfObject => {
    const out: VdfObject = {};
    while (p < tokens.length) {
      const key = tokens[p++]!;
      if (!key.quoted && key.value === '}') return out;
      const next = tokens[p];
      if (!next) break;
      if (!next.quoted && next.value === '{') { p++; out[key.value.toLowerCase()] = block(); }
      else if (!next.quoted && next.value === '}') break;
      else { p++; out[key.value.toLowerCase()] = next.value; }
    }
    return out;
  };
  return block();
}

/**
 * The user's Steam directory: the first of the usual places that exists, with symlinks
 * resolved (Ubuntu's package uses ~/.steam/debian-installation; ~/.steam/steam and
 * ~/.steam/root usually link to the real one).
 */
export function steamRoot(home: string, exists: (path: string) => boolean = existsSync): string | null {
  for (const dir of ['.local/share/Steam', '.steam/debian-installation', '.steam/steam', '.steam/root'].map((d) => join(home, d))) {
    if (exists(dir)) return canonical(dir);
  }
  return null;
}

/** The Steam command: on PATH, else where distribution packages put it. Null: Steam isn't installed. */
export function steamBinary(isExecutable: (file: string) => boolean): string | null {
  return ['steam', '/usr/games/steam', '/usr/bin/steam'].find((file) => isExecutable(file)) ?? null;
}

function readVdf(path: string): VdfObject | null {
  try { return parseVdf(readFileSync(path, 'utf8')); } catch { return null; }
}

function canonical(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

/** Every Steam library folder that exists (the root is always one). */
export function libraryPaths(root: string): string[] {
  const paths = [root];
  const data = readVdf(join(root, 'steamapps', 'libraryfolders.vdf'));
  const folders = data?.libraryfolders;
  if (folders && typeof folders === 'object') {
    for (const entry of Object.values(folders)) {
      if (typeof entry === 'object' && typeof entry.path === 'string') paths.push(entry.path);
      else if (typeof entry === 'string' && entry.startsWith('/')) paths.push(entry); // old format: "1" "/path"
    }
  }
  const seen = new Set<string>();
  return paths.filter((path) => {
    const real = canonical(path);
    if (seen.has(real) || !existsSync(join(path, 'steamapps'))) return false;
    seen.add(real);
    return true;
  });
}

/** Width and height from a JPEG's frame header, reading only the first 64 KB. */
export function jpegSize(path: string): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(65536);
    const length = readSync(fd, buf, 0, buf.length, 0);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Steam's header images are 460 x 215. */
const HEADER_ASPECT = 460 / 215;

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function list(dir: string): string[] {
  try { return readdirSync(dir).sort(); } catch { return []; }
}

/**
 * Steam's cached header artwork for a game. Older clients keep `<appid>/header.jpg` or
 * `<appid>_header.jpg`; current ones keep `<appid>/<hash>/library_header.jpg`. Failing a
 * named header, the landscape JPEG (at least 300 px wide) nearest the header's shape, so
 * 32 px icons and title-less 1920 x 620 hero banners lose to a real header.
 */
export function gameArtPath(root: string, appId: string): string | undefined {
  const cache = join(root, 'appcache', 'librarycache');
  const dir = join(cache, appId);
  const subdirs = list(dir).map((name) => join(dir, name)).filter((path) => { try { return statSync(path).isDirectory(); } catch { return false; } });
  const named = [dir, ...subdirs].flatMap((d) => [join(d, 'header.jpg'), join(d, 'library_header.jpg')]);
  for (const file of [...named, join(cache, `${appId}_header.jpg`)]) {
    if (isFile(file)) return file;
  }
  let best: { file: string; distance: number } | undefined;
  for (const d of [dir, ...subdirs]) {
    for (const name of list(d)) {
      const file = join(d, name);
      if (!name.toLowerCase().endsWith('.jpg') || !isFile(file)) continue;
      const size = jpegSize(file);
      if (!size || size.width <= size.height || size.width < 300) continue;
      const distance = Math.abs(Math.log(size.width / size.height / HEADER_ASPECT));
      if (!best || distance < best.distance) best = { file, distance };
    }
  }
  return best?.file;
}

export function isSteamTool(appId: string, name: string): boolean {
  return STEAM_TOOL_APP_IDS.has(appId) || STEAM_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Installed games, most recently played first (then by name). Never throws. */
export function findSteamGames(opts: { home: string; hidden?: Iterable<string> }): SteamGame[] {
  const root = steamRoot(opts.home);
  if (!root) return [];
  const hidden = new Set(opts.hidden ?? []);
  const games = new Map<string, SteamGame>();
  for (const library of libraryPaths(root)) {
    let files: string[] = [];
    try { files = readdirSync(join(library, 'steamapps')); } catch { continue; }
    for (const file of files.sort()) {
      if (!/^appmanifest_\d+\.acf$/.test(file)) continue;
      const state = readVdf(join(library, 'steamapps', file))?.appstate;
      if (!state || typeof state !== 'object') continue;
      const appId = typeof state.appid === 'string' ? state.appid : '';
      const name = typeof state.name === 'string' ? state.name.trim() : '';
      const flags = Number(typeof state.stateflags === 'string' ? state.stateflags : 0);
      if (!/^\d+$/.test(appId) || !name || !(flags & FULLY_INSTALLED)) continue;
      if (games.has(appId) || hidden.has(appId) || isSteamTool(appId, name)) continue;
      const lastPlayed = Number(typeof state.lastplayed === 'string' ? state.lastplayed : 0) || 0;
      games.set(appId, { appId, name, lastPlayed, art: gameArtPath(root, appId) });
    }
  }
  return [...games.values()].sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));
}

/** Launchable entries for the Games row; `steam` is the resolved Steam command. */
export function steamGameApps(games: SteamGame[], steam = 'steam'): ResolvedApp[] {
  return games.map((game) => ({
    id: `steam-${game.appId}`,
    name: game.name,
    type: 'desktop',
    group: 'games',
    brand: 'game',
    command: [steam, '-silent', '-applaunch', game.appId],
    // Proton games' windows use this class; Linux-native games use their own (not recognised yet).
    wmClass: `steam_app_${game.appId}`,
    // The `steam` command only hands the request to the Steam client: never signal it.
    handOff: true,
    art: game.art,
    hotkeys: {},
  }));
}
