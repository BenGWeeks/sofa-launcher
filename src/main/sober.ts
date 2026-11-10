/**
 * Roblox, detected: when the Sober Flatpak (which runs Roblox on Linux) is installed, the
 * catalogue's Roblox tile joins the detected games, like Steam games. Pure file checks of
 * Flatpak's deploy directories; `flatpak` is never run.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCatalogueApp, type Config, type ResolvedApp } from './config';

export const SOBER_FLATPAK = 'org.vinegarhq.Sober';
const CATALOGUE_ID = 'roblox';

/**
 * The deployed app of a system (/var/lib/flatpak) or per-user (~/.local/share/flatpak)
 * installation. `current/active` are symlinks to the deploy, so a half-removed app
 * (dangling links) doesn't count.
 */
export function flatpakAppDirs(home: string, id: string): string[] {
  return ['/var/lib/flatpak', join(home, '.local/share/flatpak')].map((root) => join(root, 'app', id, 'current', 'active', 'files'));
}

export function soberInstalled(home: string, exists: (path: string) => boolean = existsSync): boolean {
  return flatpakAppDirs(home, SOBER_FLATPAK).some((dir) => exists(dir));
}

/** Does config.toml already have a Roblox (its own entry wins: no second tile)? Hidden entries count. */
export function configHasRoblox(config: Config): boolean {
  if (config.usedCatalogue.includes(CATALOGUE_ID)) return true;
  return [...config.apps, ...config.configuredApps.map((c) => c.app)].some((a) => a.id === CATALOGUE_ID || a.flatpak === SOBER_FLATPAK);
}

/** The catalogue Roblox app when Sober is installed and config.toml doesn't define one. Never throws. */
export function detectRoblox(config: Config, opts: { home: string; exists?: (path: string) => boolean }): ResolvedApp[] {
  try {
    if (configHasRoblox(config) || !soberInstalled(opts.home, opts.exists)) return [];
    const app = resolveCatalogueApp(CATALOGUE_ID);
    return app ? [app] : [];
  } catch {
    return [];
  }
}
