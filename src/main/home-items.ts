/**
 * What Edit home screen lists, and what the home screen, slide-up panel and screen-in-screen
 * chooser show after the user's choices (home.json) are applied.
 */
import type { HomeSection } from '@shared/types';
import { CATALOGUE } from './catalogue';
import { resolveCatalogueApp, type Config, type ResolvedApp } from './config';
import { isShown, type HomeVisibility } from './home-visibility';

export interface HomeCandidate {
  app: ResolvedApp;
  section: HomeSection;
  /** Shown when the user has made no choice: config.toml's own answer. */
  defaultShown: boolean;
  /** A catalogue app that needs settings in config.toml first (a URL): listed, never launchable. */
  needsSetup?: boolean;
}

/**
 * Apps: config.toml's apps in file order (hidden ones too), then every other non-game catalogue
 * app. Games: configured games, then detected games (Roblox when Sober is installed, Steam games).
 * Cameras: as configured. `detectedGames` are every detected game; `[games]` decides which are
 * shown by default (`enabled` for all of them, `hidden` for Steam app ids).
 */
export function homeCandidates(config: Config, detectedGames: ResolvedApp[]): HomeCandidate[] {
  const configured = config.configuredApps;
  const taken = new Set([...configured.map((c) => c.app.id), ...config.apps.map((a) => a.id)]);
  const used = new Set(config.usedCatalogue);
  const out: HomeCandidate[] = [];
  for (const { app, hidden } of configured) {
    if (app.group !== 'games') out.push({ app, section: 'apps', defaultShown: !hidden });
  }
  for (const [id, entry] of Object.entries(CATALOGUE)) {
    if (entry.group === 'games' || used.has(id) || taken.has(id)) continue;
    const app = resolveCatalogueApp(id);
    out.push(app
      ? { app, section: 'apps', defaultShown: false }
      : { app: { id, name: entry.name, type: entry.type, brand: entry.brand, image: entry.image, wmClass: `sofa-${id}`, hotkeys: {} }, section: 'apps', defaultShown: false, needsSetup: true });
    taken.add(id);
  }
  for (const { app, hidden } of configured) {
    if (app.group === 'games') out.push({ app, section: 'games', defaultShown: !hidden });
  }
  const hiddenGames = new Set(config.games.hidden);
  for (const app of detectedGames) {
    if (taken.has(app.id)) continue;
    taken.add(app.id);
    const steamId = /^steam-(\d+)$/.exec(app.id)?.[1];
    out.push({ app, section: 'games', defaultShown: config.games.enabled && !(steamId && hiddenGames.has(steamId)) });
  }
  for (const app of config.apps) {
    if (app.type === 'camera') out.push({ app, section: 'cameras', defaultShown: true });
  }
  return out;
}

export interface ResolvedHome {
  /** On the home screen (and the panel and the screen-in-screen chooser), in order. */
  visible: ResolvedApp[];
  /** Everything that can be opened by id, shown or not (a hidden camera still opens by id). */
  launchable: ResolvedApp[];
}

export function resolveHome(candidates: HomeCandidate[], choices: HomeVisibility): ResolvedHome {
  const launchable = candidates.filter((c) => !c.needsSetup);
  return {
    visible: launchable.filter((c) => isShown(choices, c.app.id, c.defaultShown)).map((c) => c.app),
    launchable: launchable.map((c) => c.app),
  };
}
