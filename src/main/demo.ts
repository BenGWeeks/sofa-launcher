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

/**
 * Demo cameras with a still (`camera-demo-<n>`): most do, every third one from the second has
 * none, so screenshots show working cameras first and the rest keeping their icon.
 */
export function demoCameraHasStill(appId: string): boolean {
  const index = /^camera-demo-(\d{1,2})$/.exec(appId)?.[1];
  return index !== undefined && Number(index) % 3 !== 1;
}

/**
 * A placeholder camera still as raw BGRA pixels (for nativeImage.createFromBitmap): a made-up
 * scene (sky, a building's outline, a lit window, the ground) in the muted colours of a security
 * camera, some by day and some by night-vision green. Never a real picture.
 */
export function demoCameraStillBitmap(index: number, width = 480, height = 270): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const night = index % 4 === 3;
  // Deterministic pseudo-random per camera, so a screenshot is the same every time.
  let seed = (index + 1) * 2654435761 >>> 0;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const horizon = height * (0.45 + random() * 0.15);
  const roofLeft = width * (0.1 + random() * 0.3), roofRight = roofLeft + width * (0.3 + random() * 0.25);
  const wall = horizon - height * (0.2 + random() * 0.12), peak = wall - height * (0.08 + random() * 0.1);
  const windowX = roofLeft + (roofRight - roofLeft) * (0.25 + random() * 0.4), windowY = wall + (horizon - wall) * 0.3;
  const tint = index * 47 % 360;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number;
      const mid = (roofLeft + roofRight) / 2;
      const roofY = peak + (wall - peak) * Math.min(1, Math.abs(x - mid) / ((roofRight - roofLeft) / 2));
      const inHouse = x >= roofLeft && x <= roofRight && y >= roofY && y < horizon;
      if (y < horizon) {
        const t = y / horizon;
        [r, g, b] = [90 + 60 * t, 120 + 50 * t, 150 + 30 * t];
      } else {
        const t = (y - horizon) / (height - horizon);
        const stripe = Math.sin((x - width / 2) / Math.max(8, y - horizon + 8) * 6) > 0.9 ? 10 : 0;
        [r, g, b] = [70 - 30 * t + stripe, 82 - 30 * t + stripe, 62 - 25 * t + stripe];
      }
      if (inHouse) {
        const lit = Math.abs(x - windowX) < 14 && Math.abs(y - windowY) < 10;
        [r, g, b] = lit ? [230, 200, 130] : [55 + (tint % 30), 50, 48];
      }
      const noise = (random() - 0.5) * 14;
      const dx = x / width - 0.5, dy = y / height - 0.5;
      const vignette = 1 - (dx * dx + dy * dy) * 1.1;
      if (night) { const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.8; [r, g, b] = [l * 0.55, l * 1.05, l * 0.6]; }
      const i = (y * width + x) * 4;
      const clamp = (v: number) => Math.max(0, Math.min(255, Math.round((v + noise) * vignette)));
      buf[i] = clamp(b); buf[i + 1] = clamp(g); buf[i + 2] = clamp(r); buf[i + 3] = 255;
    }
  }
  return buf;
}
