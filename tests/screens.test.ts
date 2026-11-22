import { describe, expect, it } from 'vitest';
import { nameDisplays, parseMonitors, pickDisplay } from '../src/main/screens';

const XRANDR = `Monitors: 2
 0: +*eDP-1 1920/302x1200/189+0+0  eDP-1
 1: +HDMI-A-1 1920/698x1080/392+1920+0  HDMI-A-1
`;
const laptop = { id: 33, bounds: { x: 0, y: 0, width: 1920, height: 1200 }, scaleFactor: 1, internal: true };
const tv = { id: 1, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, internal: false };
const same = (p: { x: number; y: number }) => p;

describe('parseMonitors', () => {
  it('reads connector names, sizes and positions', () => {
    expect(parseMonitors(XRANDR)).toEqual([
      { name: 'eDP-1', width: 1920, height: 1200, x: 0, y: 0 },
      { name: 'HDMI-A-1', width: 1920, height: 1080, x: 1920, y: 0 },
    ]);
  });

  it('reads negative offsets and ignores anything else', () => {
    expect(parseMonitors(' 0: +DP-2 2560/600x1440/340-2560+0  DP-2\nnot a monitor\n')).toEqual([{ name: 'DP-2', width: 2560, height: 1440, x: -2560, y: 0 }]);
    expect(parseMonitors('')).toEqual([]);
  });

  it('skips names that are not plain connector names', () => {
    expect(parseMonitors(' 0: +bad"name 1920/1x1080/1+0+0  x')).toEqual([]);
  });
});

describe('nameDisplays', () => {
  it('names each display after the connector at the same position', () => {
    expect(nameDisplays([laptop, tv], parseMonitors(XRANDR), same).map((n) => n.name)).toEqual(['eDP-1', 'HDMI-A-1']);
  });

  it('compares in physical pixels on a scaled screen', () => {
    const scaled = { id: 2, bounds: { x: 960, y: 0, width: 1280, height: 720 }, scaleFactor: 2 };
    const physical = (p: { x: number; y: number }) => ({ x: p.x * 2, y: p.y * 2 });
    expect(nameDisplays([scaled], parseMonitors(XRANDR), physical)[0]!.name).toBe('HDMI-A-1');
  });

  it('falls back to a numbered name without xrandr', () => {
    expect(nameDisplays([laptop, tv], [], same).map((n) => n.name)).toEqual(['screen-1', 'screen-2']);
  });
});

describe('pickDisplay', () => {
  const named = nameDisplays([laptop, tv], parseMonitors(XRANDR), same);
  it('uses the primary screen for "auto"', () => expect(pickDisplay('auto', named, laptop)).toBe(laptop));
  it('uses the chosen screen when it is connected', () => expect(pickDisplay('HDMI-A-1', named, laptop)).toBe(tv));
  it('falls back to the primary screen when the chosen one is unplugged', () => expect(pickDisplay('HDMI-A-1', named.slice(0, 1), laptop)).toBe(laptop));
  it('keeps a numbered choice working once xrandr names the screens', () => {
    expect(pickDisplay('screen-2', named, laptop)).toBe(tv);
    expect(pickDisplay('screen-3', named, laptop)).toBe(laptop);
  });
});
