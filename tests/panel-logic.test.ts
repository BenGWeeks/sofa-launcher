import { describe, expect, it } from 'vitest';
import { contextFor, decideHome, decideMenu } from '../src/main/panel-logic';
import { movePanelFocus } from '../src/renderer/src/lib/nav';
import { parseRoute } from '../src/renderer/src/lib/route';
import { IDLE_EXIT_SECONDS, nextExitPresses, shouldExit } from '../src/renderer/src/lib/buttontest';

describe('Home and Menu decisions', () => {
  it.each([true, false])('Home always shows full home (launcher=%s)', (launcherInFront) => {
    for (const panelOpen of [true, false]) expect(decideHome({ launcherInFront, panelOpen })).toBe('show-home');
  });
  it('Menu opens settings on home, a panel over apps, and closes an open panel', () => {
    expect(decideMenu({ launcherInFront: true, panelOpen: false })).toBe('settings');
    expect(decideMenu({ launcherInFront: false, panelOpen: false })).toBe('open-panel');
    for (const launcherInFront of [true, false]) expect(decideMenu({ launcherInFront, panelOpen: true })).toBe('close-panel');
  });
});

describe('contextFor (remote guide)', () => {
  it('describes home, app or panel', () => {
    expect(contextFor({ launcherInFront: true, panelOpen: false })).toBe('home');
    expect(contextFor({ launcherInFront: false, panelOpen: false })).toBe('app');
    expect(contextFor({ launcherInFront: false, panelOpen: true })).toBe('panel');
  });
});

describe('movePanelFocus', () => {
  const tiles = 6;
  const actions = 3;
  it('moves along the tile row and clamps', () => {
    expect(movePanelFocus({ row: 0, index: 0 }, 'ArrowLeft', tiles, actions)).toEqual({ row: 0, index: 0 });
    expect(movePanelFocus({ row: 0, index: 5 }, 'ArrowRight', tiles, actions)).toEqual({ row: 0, index: 5 });
    expect(movePanelFocus({ row: 0, index: 2 }, 'ArrowRight', tiles, actions)).toEqual({ row: 0, index: 3 });
  });
  it('drops to the action row and clamps the index to the actions available', () => {
    expect(movePanelFocus({ row: 0, index: 5 }, 'ArrowDown', tiles, actions)).toEqual({ row: 1, index: 2 });
    expect(movePanelFocus({ row: 1, index: 2 }, 'ArrowDown', tiles, actions)).toEqual({ row: 1, index: 2 });
  });
  it('returns to the tile row', () => {
    expect(movePanelFocus({ row: 1, index: 1 }, 'ArrowUp', tiles, actions)).toEqual({ row: 0, index: 1 });
    expect(movePanelFocus({ row: 0, index: 1 }, 'ArrowUp', tiles, actions)).toEqual({ row: 0, index: 1 });
  });
  it('ignores other keys and empty rows', () => {
    expect(movePanelFocus({ row: 0, index: 1 }, 'Enter', tiles, actions)).toEqual({ row: 0, index: 1 });
    expect(movePanelFocus({ row: 0, index: 1 }, 'ArrowDown', tiles, 0)).toEqual({ row: 0, index: 1 });
  });
});

describe('button test exit rules', () => {
  it('exits on Back twice or Home twice, not on a mix or other buttons in between', () => {
    let p = nextExitPresses({ id: null, count: 0 }, 'back');
    expect(shouldExit(p)).toBe(false);
    p = nextExitPresses(p, 'home');
    expect(shouldExit(p)).toBe(false);
    p = nextExitPresses(p, 'home');
    expect(shouldExit(p)).toBe(true);
    p = nextExitPresses({ id: 'back', count: 1 }, 'red');
    expect(p).toEqual({ id: null, count: 0 });
    expect(shouldExit(nextExitPresses({ id: 'back', count: 1 }, null))).toBe(false);
    expect(shouldExit(nextExitPresses({ id: 'back', count: 1 }, 'back'))).toBe(true);
  });
  it('has an idle timeout of about twenty seconds', () => {
    expect(IDLE_EXIT_SECONDS).toBeGreaterThanOrEqual(15);
    expect(IDLE_EXIT_SECONDS).toBeLessThanOrEqual(30);
  });
});

describe('parseRoute', () => {
  it('defaults to home', () => {
    expect(parseRoute('')).toEqual({ route: 'home', demo: null });
    expect(parseRoute('#home')).toEqual({ route: 'home', demo: null });
    expect(parseRoute('#nonsense')).toEqual({ route: 'home', demo: null });
  });
  it('recognises the panel and toast windows and demo data', () => {
    expect(parseRoute('#panel')).toEqual({ route: 'panel', demo: null });
    expect(parseRoute('#toast')).toEqual({ route: 'toast', demo: null });
    expect(parseRoute('#panel?demo=1')).toEqual({ route: 'panel', demo: '1' });
    expect(parseRoute('#home?demo=button-test')).toEqual({ route: 'home', demo: 'button-test' });
  });
});
