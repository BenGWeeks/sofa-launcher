import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_CAMERA_ART, DEMO_STEAM_GAMES, demoCameraHasStill } from '../src/main/demo';

const folder = join(__dirname, '..', 'docs', 'demo-art');

describe('demo pictures', () => {
  it('has a file for every game picture named in the demo', () => {
    const named = DEMO_STEAM_GAMES.flatMap((g) => (g.art ? [g.art] : []));
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) expect(existsSync(join(folder, file)), file).toBe(true);
  });

  it('has a file for every camera picture, and only for cameras that show one', () => {
    for (const [index, file] of Object.entries(DEMO_CAMERA_ART)) {
      expect(existsSync(join(folder, file)), file).toBe(true);
      expect(demoCameraHasStill(`camera-demo-${index}`), `camera ${index}`).toBe(true);
    }
  });

  it('keeps a made-up game first-played and last, which the screenshot checks rely on', () => {
    expect(DEMO_STEAM_GAMES.at(-1)?.name).toBe('Paper Planets');
  });
});
