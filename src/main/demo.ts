import { parseConfig, SEED_CONFIG, type Config } from './config';
import type { Background, Theme } from '@shared/types';
import { DEFAULT_BACKGROUND } from '@shared/backgrounds';
import type { ResolvedApp } from './config';
import { steamGameApps, type SteamGame } from './steam';

/**
 * Demo mode: `--demo`, `--screenshot=…` or any `--demo-…` flag. It must never touch the
 * machine's own apps: no real config, no Steam library, no launches (see AppManager `demo`).
 */
export function isDemoMode(argv: readonly string[]): boolean {
  return argv.some((a) => a === '--demo' || a.startsWith('--demo-') || a.startsWith('--screenshot='));
}

/** Deterministic screenshot config, independent of workstation settings. */
const DEMO_CAMERAS = ['Front door', 'Barn', 'Garden', 'Driveway', 'Hall', 'Side gate', 'Patio', 'Garage', 'Nursery'];

/** `cameras`: false, true (the nine demo cameras) or a count from 1 to 32 (more are numbered). */
export function screenshotConfig(theme: Theme = 'knowall', cameras: boolean | number = false, background: Background = DEFAULT_BACKGROUND, games = false): Config {
  const count = cameras === true ? DEMO_CAMERAS.length : cameras === false ? 0 : Math.max(0, Math.min(32, Math.floor(cameras)));
  const names = Array.from({ length: count }, (_, i) => DEMO_CAMERAS[i] ?? `Camera ${i + 1}`);
  const cameraConfig = names.map((name, index) => `\n[[cameras]]\nid="demo-${index}"\nname="${name}"\nentity="camera.demo_${index}"`).join('');
  // A configured (non-Steam) game, ahead of the detected Steam games.
  const gameConfig = games ? '\n[[apps]]\nid = "roblox"\ncatalogue = "roblox"\n' : '';
  const config = parseConfig(SEED_CONFIG + gameConfig + cameraConfig);
  config.ui.theme = theme;
  config.ui.background = background;
  return config;
}

/** Fictional Steam games for screenshots (`--demo-games`). Art is generated, never real cover art. */
export const DEMO_STEAM_GAMES: (SteamGame & { hue?: number })[] = [
  { appId: '9000001', name: 'Starfall Drift', lastPlayed: 7, hue: 265 },
  { appId: '9000002', name: 'Cobalt Harbour', lastPlayed: 6, hue: 205 },
  { appId: '9000003', name: 'Tiny Kingdoms', lastPlayed: 5, hue: 120 },
  { appId: '9000004', name: 'Neon Kart Rally', lastPlayed: 4, hue: 320 },
  { appId: '9000005', name: 'Moss & Lantern', lastPlayed: 3 },
  { appId: '9000006', name: 'Deep Field', lastPlayed: 2, hue: 25 },
  { appId: '9000007', name: 'Paper Planets', lastPlayed: 1 },
];

/** The stand-ins' launch command: not a real program, so it could never reach the Steam client. */
export const DEMO_STEAM_COMMAND = 'sofa-demo-steam';

/**
 * The detected Steam games for the Games row. In demo mode only the stand-ins (`--demo-games`)
 * are listed and `detect` is never called, so the machine's Steam library is not read.
 */
export function steamGamesRow(demo: { on: boolean; games: boolean }, detect: () => ResolvedApp[]): ResolvedApp[] {
  if (demo.on) return demo.games ? steamGameApps(DEMO_STEAM_GAMES, DEMO_STEAM_COMMAND) : [];
  return detect();
}

/**
 * Placeholder artwork as raw BGRA pixels (for nativeImage.createFromBitmap): a diagonal
 * gradient in one hue with soft bands and a glow, so tiles look like art without being any.
 */
export function demoArtBitmap(hue: number, width = 460, height = 215): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const rgb = (h: number, s: number, l: number): [number, number, number] => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const band = Math.sin((x * 0.6 - y) / 18) > 0.55 ? 0.06 : 0;
      const dx = (x - width * 0.72) / width, dy = (y - height * 0.35) / height;
      const glow = Math.max(0, 0.32 - Math.sqrt(dx * dx + dy * dy)) * 0.9;
      const [r, g, b] = rgb((hue + t * 40) % 360, 0.65, Math.min(0.85, 0.16 + t * 0.32 + band + glow));
      const i = (y * width + x) * 4;
      buf[i] = Math.round(b * 255); buf[i + 1] = Math.round(g * 255); buf[i + 2] = Math.round(r * 255); buf[i + 3] = 255;
    }
  }
  return buf;
}
