/**
 * Which screen Sofa runs on (Menu → Settings → Screen, or `[ui] screen` in config.toml).
 *
 * Electron numbers its displays and often leaves the label empty (an HDMI TV has none), so a
 * choice is kept by connector name ("HDMI-A-1"), the name the desktop's display settings use.
 * The names come from `xrandr --listmonitors` and are matched to Electron's displays by position.
 */

export interface Rect { x: number; y: number; width: number; height: number }

/** One `xrandr --listmonitors` entry: connector name and position in physical pixels. */
export interface Monitor extends Rect { name: string }

/** The minimum of an Electron display that this module needs. */
export interface DisplayLike { id: number; bounds: Rect; scaleFactor: number; internal?: boolean; label?: string }

export interface NamedDisplay<D extends DisplayLike = DisplayLike> { name: string; display: D }

/** "auto" (the primary screen) or a connector name. Kept short and plain: it is written into TOML. */
export const SCREEN_NAME = /^[A-Za-z0-9._-]{1,32}$/;

/** ` 1: +HDMI-A-1 1920/698x1080/392+1920+0  HDMI-A-1` → name, size and origin. */
export function parseMonitors(stdout: string): Monitor[] {
  const monitors: Monitor[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*\d+:\s+[+*]*(\S+)\s+(\d+)\/\d+x(\d+)\/\d+([+-]\d+)([+-]\d+)/.exec(line);
    if (m && SCREEN_NAME.test(m[1]!)) monitors.push({ name: m[1]!, width: Number(m[2]), height: Number(m[3]), x: Number(m[4]), y: Number(m[5]) });
  }
  return monitors;
}

/**
 * Give each display a stable name: its connector where xrandr reports one at the same place,
 * otherwise "screen-N" (still selectable, but not guaranteed to survive a restart).
 * `toPhysical` turns a display's origin into physical pixels, as xrandr reports them.
 */
export function nameDisplays<D extends DisplayLike>(displays: readonly D[], monitors: readonly Monitor[], toPhysical: (point: { x: number; y: number }) => { x: number; y: number }): NamedDisplay<D>[] {
  const used = new Set<string>();
  return displays.map((display, i) => {
    const origin = toPhysical({ x: display.bounds.x, y: display.bounds.y });
    const match = monitors.find((m) => !used.has(m.name) && m.x === origin.x && m.y === origin.y);
    if (match) used.add(match.name);
    return { name: match?.name ?? `screen-${i + 1}`, display };
  });
}

/**
 * The display a choice points at: the named one when it is connected, else the primary one.
 * A numbered name ("screen-2", offered while xrandr could not be read) keeps meaning the Nth
 * display after xrandr names it.
 */
export function pickDisplay<D extends DisplayLike>(choice: string, named: readonly NamedDisplay<D>[], primary: D): D {
  if (choice === 'auto') return primary;
  const byName = named.find((n) => n.name === choice)?.display;
  if (byName) return byName;
  const numbered = /^screen-(\d+)$/.exec(choice);
  return (numbered ? named[Number(numbered[1]) - 1]?.display : undefined) ?? primary;
}
