/**
 * Edit home screen's choices, kept apart from the hand-edited config.toml in
 * `<config dir>/home.json`:
 *
 *   { "version": 1, "hidden": ["netflix", "steam-552990", "camera-front-door"], "shown": ["disney"] }
 *
 * Ids are the launcher's own app ids (config/catalogue ids, `steam-<appid>`, `camera-<id>`,
 * `all-cameras`). Only choices that differ from config.toml's default are stored, and a stored
 * choice wins over config.toml. A missing or malformed file means "no choices"; invalid entries
 * are dropped one by one; ids the launcher doesn't know (a game uninstalled for now) are kept
 * but have no effect.
 */
import { readFileSafely, writeFileAtomic } from './config-writer';

export const HOME_FILE = 'home.json';
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_IDS = 2000;
const MAX_BYTES = 256 * 1024;

export interface HomeVisibility {
  hidden: ReadonlySet<string>;
  shown: ReadonlySet<string>;
}

export const NO_CHOICES: HomeVisibility = { hidden: new Set(), shown: new Set() };

export function isHomeId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isHomeId).slice(0, MAX_IDS) : [];
}

/** Never throws: anything unusable means no choices. An id in both lists counts as hidden. */
export function parseHomeVisibility(text: string): HomeVisibility {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return NO_CHOICES; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return NO_CHOICES;
  const record = data as Record<string, unknown>;
  const hidden = new Set(ids(record.hidden));
  return { hidden, shown: new Set(ids(record.shown).filter((id) => !hidden.has(id))) };
}

export function serializeHomeVisibility(v: HomeVisibility): string {
  return `${JSON.stringify({ version: 1, hidden: [...v.hidden].sort(), shown: [...v.shown].sort() }, null, 2)}\n`;
}

/** Is this item on the home screen? A stored choice wins; otherwise config.toml's default. */
export function isShown(v: HomeVisibility, id: string, defaultShown: boolean): boolean {
  if (v.hidden.has(id)) return false;
  if (v.shown.has(id)) return true;
  return defaultShown;
}

/** Record a choice; one that matches the default is forgotten, so config.toml governs again. */
export function withChoice(v: HomeVisibility, id: string, shown: boolean, defaultShown: boolean): HomeVisibility {
  if (!isHomeId(id)) throw new Error('Invalid home screen item');
  const hidden = new Set(v.hidden);
  const visible = new Set(v.shown);
  hidden.delete(id);
  visible.delete(id);
  if (shown !== defaultShown) (shown ? visible : hidden).add(id);
  if (hidden.size > MAX_IDS || visible.size > MAX_IDS) throw new Error('Too many home screen choices');
  return { hidden, shown: visible };
}

/** Never throws (a broken file must never stop the launcher starting). */
export function readHomeVisibility(path: string): HomeVisibility {
  try {
    const text = readFileSafely(path, MAX_BYTES);
    return text === null ? NO_CHOICES : parseHomeVisibility(text);
  } catch {
    return NO_CHOICES;
  }
}

/**
 * Apply one choice to what is on disk now (read and replaced atomically, mode 0600, never
 * through a symlink) and return the result.
 */
export function writeHomeChoice(path: string, id: string, shown: boolean, defaultShown: boolean): HomeVisibility {
  let result: HomeVisibility = NO_CHOICES;
  writeFileAtomic(path, (source) => {
    result = withChoice(source ? parseHomeVisibility(source) : NO_CHOICES, id, shown, defaultShown);
    return serializeHomeVisibility(result);
  }, { mode: 0o600, maxBytes: MAX_BYTES });
  return result;
}
