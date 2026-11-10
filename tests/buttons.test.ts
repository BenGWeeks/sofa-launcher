import { describe, expect, it } from 'vitest';
import {
  buttonMap, describeFor, GROUPS, keyFromEvent, legendFor, matchKey, normalizeKey, REMOTE_LAYOUT, type ButtonContext,
} from '../src/shared/buttons';
import type { GlobalAction } from '../src/shared/types';
import { DEFAULT_BUTTONS } from '../src/main/config';

const CONTEXTS: ButtonContext[] = ['home', 'app', 'panel'];
const ACTIONS: GlobalAction[] = Object.keys(DEFAULT_BUTTONS) as GlobalAction[];
const buttons = buttonMap(DEFAULT_BUTTONS);

describe('button map contract', () => {
  it('has exactly one button per global action, with a label, a key and a description for every context', () => {
    for (const action of ACTIONS) {
      const matches = buttons.filter((b) => b.action === action);
      expect(matches, action).toHaveLength(1);
      const b = matches[0]!;
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.does.length).toBeGreaterThan(0);
      expect(b.key).toBe(normalizeKey(DEFAULT_BUTTONS[action]));
      for (const c of CONTEXTS) expect(describeFor(b, c, 'Netflix'), `${action}/${c}`).not.toBe('');
    }
  });

  it('uses the configured accelerator, not a hard-coded one', () => {
    const custom = buttonMap({ ...DEFAULT_BUTTONS, home: 'ctrl+shift+alt+F1', back: 'ctrl+shift+alt+F2' });
    expect(custom.find((b) => b.id === 'home')?.key).toBe('Ctrl+Alt+Shift+F1');
    expect(custom.find((b) => b.id === 'back')?.key).toBe('Ctrl+Alt+Shift+F2');
  });

  it('has unique ids and keys (two buttons can never claim the same key)', () => {
    const ids = buttons.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = buttons.flatMap((b) => [b.key, ...b.altKeys]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('draws every button on the remote exactly once, and nothing that does not exist', () => {
    const drawn = REMOTE_LAYOUT.flat().filter((id): id is string => !!id && id !== 'ring');
    const ringIds = ['up', 'down', 'left', 'right', 'ok'];
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(REMOTE_LAYOUT.flat()).toContain('ring');
    expect([...drawn, ...ringIds].sort()).toEqual(buttons.map((b) => b.id).sort());
  });

  it('every group has a label', () => {
    for (const g of new Set(buttons.map((b) => b.group).filter(Boolean))) expect(GROUPS[g!]).toBeDefined();
  });

  it('substitutes the app name into descriptions', () => {
    const back = buttons.find((b) => b.id === 'back')!;
    expect(describeFor(back, 'app', 'Netflix')).toBe('Back inside Netflix');
  });
});

describe('legendFor', () => {
  it('lists only buttons that do something in the context, collapsing groups', () => {
    const home = legendFor(buttons, 'home');
    expect(home.map((r) => r.id)).toContain('arrows');
    expect(home.filter((r) => r.id === 'arrows')).toHaveLength(1);
    expect(home.find((r) => r.id === 'arrows')?.ids).toEqual(['up', 'down', 'left', 'right']);
    expect(home.map((r) => r.id)).not.toContain('playPause');
    expect(legendFor(buttons, 'app', 'Prime Video').find((r) => r.id === 'playPause')?.text).toBe('Play / pause in Prime Video');
  });

  it('explains TIDAL track controls in its guide', () => {
    expect(legendFor(buttons, 'app', 'TIDAL').find(row => row.id === 'seek')?.text).toBe('Previous / next track in TIDAL');
  });

  it('includes every global action in every context', () => {
    for (const c of CONTEXTS) {
      const ids = legendFor(buttons, c).flatMap((r) => r.ids);
      for (const b of buttons.filter((x) => x.action)) expect(ids, `${b.id}/${c}`).toContain(b.id);
    }
  });
});

describe('keys', () => {
  it('normalises accelerators to one spelling', () => {
    expect(normalizeKey('Ctrl+Alt+Shift+H')).toBe('Ctrl+Alt+Shift+H');
    expect(normalizeKey('shift+control+alt+h')).toBe('Ctrl+Alt+Shift+H');
    expect(normalizeKey('CommandOrControl+Alt+Shift+p')).toBe('Ctrl+Alt+Shift+P');
    expect(normalizeKey('MediaPlayPause')).toBe('MediaPlayPause');
  });

  it('describes a keydown like an accelerator, ignoring Shift’s effect on the character', () => {
    const ev = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
      key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
    });
    expect(keyFromEvent(ev('H', 'KeyH', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe('Ctrl+Alt+Shift+H');
    expect(keyFromEvent(ev('!', 'Digit1', { shiftKey: true }))).toBe('Shift+1');
    expect(keyFromEvent(ev('ArrowUp', 'ArrowUp'))).toBe('ArrowUp');
    expect(keyFromEvent(ev('BrowserBack', 'BrowserBack'))).toBe('BrowserBack');
    expect(keyFromEvent(ev('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull();
  });

  it('matches exact keys, flags alternatives, and rejects unknown keys', () => {
    expect(matchKey(buttons, 'Ctrl+Alt+Shift+R')).toMatchObject({ button: { id: 'red' }, exact: true });
    expect(matchKey(buttons, 'BrowserBack')).toMatchObject({ button: { id: 'back' }, exact: false });
    expect(matchKey(buttons, 'Backspace')).toMatchObject({ button: { id: 'back' }, exact: false });
    expect(matchKey(buttons, 'Escape')).toMatchObject({ button: { id: 'back' }, exact: false });
    expect(matchKey(buttons, 'Ctrl+Alt+Shift+K')).toMatchObject({ button: { id: 'back' }, exact: true });
    expect(matchKey(buttons, '7')).toMatchObject({ button: { id: 'digit7' }, exact: true });
    expect(matchKey(buttons, 'Ctrl+Alt+Shift+Q')).toBeNull();
  });
});

describe('legend symbols', () => {
  it.each(CONTEXTS)('prints E and OK once in %s, preserving other button icons', (context) => {
    const rows = legendFor(buttons, context);
    expect(rows.find((r) => r.id === 'e')).toMatchObject({ label: 'E', icon: undefined });
    expect(rows.find((r) => r.id === 'ok')).toMatchObject({ label: 'OK', icon: undefined });
    expect(rows.find((r) => r.id === 'home')).toMatchObject({ label: 'Home', icon: 'home' });
    expect(rows.find((r) => r.id === 'arrows')).toMatchObject({ label: 'Arrows', icon: 'up' });
  });
});
