/**
 * The one description of the SofaBaton U1's buttons. The remote guide, the
 * button test and the hint bar all read this, so they can't drift apart.
 * Keys follow docs/keymap.md: launcher buttons send Ctrl+Alt+Shift+letter
 * (from config), pass-through buttons send fixed standard keys.
 */
import type { GlobalAction } from './types';

/** Where the user is when they press a button. */
export type ButtonContext = 'home' | 'app' | 'panel';

export type ButtonColor = 'red' | 'green' | 'yellow' | 'blue';

export type RemoteIconId = 'power' | 'input' | 'menu' | 'home' | 'info' | 'back' | 'ok' | 'up' | 'down' | 'left' | 'right' | 'chUp' | 'chDown' | 'volUp' | 'volDown' | 'mute' | 'rew' | 'play' | 'pause' | 'playPause' | 'ff' | 'stop' | 'record' | ButtonColor | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'e' | 'minus';

export interface ButtonDef {
  id: string;
  /** Short name, e.g. "Home". */
  label: string;
  /** Symbol printed on the remote. */
  icon: RemoteIconId;
  /** Launcher action, for global buttons. */
  action?: GlobalAction;
  /** What the launcher does when it receives it, in a few words. */
  does: string;
  /** The key the Flirc sends, normalised ("Ctrl+Alt+Shift+H", "ArrowUp", "BrowserBack"). */
  key: string;
  /** Keys that also count, but flag a warning (a different key than docs/keymap.md). */
  altKeys: string[];
  /**
   * What the button does in each context. "{app}" is replaced with the app's name.
   * An empty string means "nothing launcher-related": not listed in the guide.
   */
  describe: Record<ButtonContext, string>;
  /** Buttons shown as one guide row / test cell (arrows, digits, volume). */
  group?: string;
  color?: ButtonColor;
}

export interface ButtonGroup {
  label: string;
  icon: RemoteIconId;
  /** What the group's keys are called, for the button test ("Arrow keys"). */
  keys: string;
}

export const GROUPS: Record<string, ButtonGroup> = {
  arrows: { label: 'Arrows', icon: 'up', keys: 'Arrow keys' },
  channel: { label: 'Channel', icon: 'chUp', keys: 'Page Up / Down' },
  volume: { label: 'Volume', icon: 'volUp', keys: 'Volume keys' },
  seek: { label: 'Rew / FF', icon: 'rew', keys: 'Media Rewind / Fast Forward' },
  digits: { label: '0–9', icon: '0', keys: 'Digits' },
};

const all = (text: string): Record<ButtonContext, string> => ({ home: text, app: text, panel: text });

/** Order of an accelerator's modifiers once normalised. */
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIERS)[number]> = {
  ctrl: 'Ctrl', control: 'Ctrl', cmdorctrl: 'Ctrl', commandorcontrol: 'Ctrl',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  super: 'Super', meta: 'Super', cmd: 'Super', command: 'Super',
};

/** "ctrl+shift+alt+h" → "Ctrl+Alt+Shift+H": one spelling for Electron accelerators and key events alike. */
export function normalizeKey(accelerator: string): string {
  const mods = new Set<(typeof MODIFIERS)[number]>();
  let key = '';
  for (const part of accelerator.split('+')) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()];
    if (alias) mods.add(alias);
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  return [...MODIFIERS.filter((m) => mods.has(m)), key].filter(Boolean).join('+');
}

/** A keydown as the button test sees it (the fields of KeyboardEvent it needs). */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Describe a keydown as a normalised combo, or null for a lone modifier. */
export function keyFromEvent(e: KeyPress): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
  // Letters and digits by physical key, so Shift doesn't turn "h" into "H" or "1" into "!".
  const base = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.key;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, base].join('+');
}

/** Build the button map for a configured [buttons] table (accelerator per global action). */
export function buttonMap(accelerators: Record<GlobalAction, string>): ButtonDef[] {
  const g = (action: GlobalAction) => normalizeKey(accelerators[action]);
  return [
    // ---- launcher buttons (global, grabbed) ---------------------------------
    {
      id: 'home', label: 'Home', icon: 'home', action: 'home', does: 'Home screen', key: g('home'), altKeys: [],
      describe: {
        home: 'You’re on the home screen already',
        app: 'Full home screen',
        panel: 'Full home screen',
      },
    },
    {
      id: 'power', label: 'Power', icon: 'power', action: 'power', does: 'Power menu', key: g('power'), altKeys: [],
      describe: all('Power menu: close launcher · log off · screen off'),
    },
    {
      id: 'red', label: 'Red', icon: 'red', color: 'red', action: 'cameraToggle', does: 'Screen-in-screen',
      key: g('cameraToggle'), altKeys: [], describe: all('Choose main and inset apps; stop screen-in-screen when active'),
    },
    {
      id: 'green', label: 'Green', icon: 'green', color: 'green', action: 'cameraNext', does: 'Switch remote focus',
      key: g('cameraNext'), altKeys: [], describe: all('Switch remote controls between the main and inset apps'),
    },
    {
      id: 'yellow', label: 'Yellow', icon: 'yellow', color: 'yellow', action: 'cameraCorner', does: 'Move inset',
      key: g('cameraCorner'), altKeys: [], describe: all('Move the inset app to the next corner'),
    },
    {
      id: 'blue', label: 'Blue', icon: 'blue', color: 'blue', action: 'blue', does: 'Resize inset',
      key: g('blue'), altKeys: [], describe: all('Resize the inset app: 30%, 40% or 50% of screen width'),
    },
    {
      id: 'record', label: 'Record', icon: 'record', action: 'nodieTalk', does: 'Talk to Nod.ie',
      key: g('nodieTalk'), altKeys: [], describe: all('Talk to Nod.ie'),
    },
    {
      id: 'info', label: 'Info', icon: 'info', action: 'info', does: 'Remote guide', key: g('info'), altKeys: [],
      describe: { home: 'This guide; press again to close', app: 'This guide, for {app}', panel: 'This guide' },
    },
    {
      id: 'menu', label: 'Menu', icon: 'menu', action: 'menu', does: 'Settings menu', key: g('menu'), altKeys: [],
      describe: {
        home: 'Settings: planned apps/cameras · button test · guide · about · quit',
        app: 'Launcher panel over {app}',
        panel: 'Close the panel, back to {app}',
      },
    },
    {
      id: 'input', label: 'Input', icon: 'input', action: 'input', does: 'Keyboard / microphone', key: g('input'), altKeys: [],
      describe: all('Open the keyboard / microphone for text input'),
    },
    {
      id: 'e', label: 'E', icon: 'e', action: 'spareE', does: 'Subtitles on/off', key: g('spareE'), altKeys: [],
      describe: all('Subtitles on/off in the selected player, when available'),
    },
    {
      id: 'back', label: 'Back', icon: 'back', action: 'back', does: 'Back', key: g('back'), altKeys: ['Escape', 'Backspace', 'BrowserBack'],
      describe: { home: 'Back to the last app', app: 'Back inside {app}', panel: 'Close the panel, back to {app}' },
    },

    // ---- navigation (pass-through) ------------------------------------------
    ...(['Up', 'Down', 'Left', 'Right'] as const).map((dir) => ({
      id: dir.toLowerCase(), label: dir, icon: dir.toLowerCase() as RemoteIconId, does: 'Move', key: `Arrow${dir}`, altKeys: [], group: 'arrows',
      describe: { home: 'Move between tiles', app: 'Navigate inside {app}', panel: 'Move around the panel' },
    })),
    {
      id: 'ok', label: 'OK', icon: 'ok', does: 'Select', key: 'Enter', altKeys: ['NumpadEnter', ' '],
      describe: { home: 'Open the highlighted app', app: 'Select in {app}', panel: 'Select the highlighted app or action' },
    },
    {
      id: 'chUp', label: 'Channel up', icon: 'chUp', does: 'Page up', key: 'PageUp', altKeys: [], group: 'channel',
      describe: { home: '', app: 'Scroll a page in {app}', panel: '' },
    },
    {
      id: 'chDown', label: 'Channel down', icon: 'chDown', does: 'Page down', key: 'PageDown', altKeys: [], group: 'channel',
      describe: { home: '', app: 'Scroll a page in {app}', panel: '' },
    },

    // ---- sound & media (system volume and selected-player transport) ----------------------
    {
      id: 'volUp', label: 'VOL +', icon: 'volUp', does: 'Volume up', key: 'AudioVolumeUp', altKeys: [], group: 'volume',
      describe: all('Selected app volume in screen-in-screen when available; otherwise system volume'),
    },
    {
      id: 'volDown', label: 'VOL −', icon: 'volDown', does: 'Volume down', key: 'AudioVolumeDown', altKeys: [], group: 'volume',
      describe: all('Selected app volume in screen-in-screen when available; otherwise system volume'),
    },
    {
      id: 'mute', label: 'Mute', icon: 'mute', does: 'Mute', key: 'AudioVolumeMute', altKeys: [],
      describe: all('Mute selected app in screen-in-screen when available; otherwise system mute'),
    },
    {
      id: 'playPause', label: 'Play / Pause', icon: 'playPause', does: 'Play / pause', key: 'MediaPlayPause',
      altKeys: ['MediaPlay', 'MediaPause'], describe: { home: '', app: 'Play / pause in {app}', panel: '' },
    },
    {
      id: 'stop', label: 'Stop', icon: 'stop', does: 'Stop', key: 'MediaStop', altKeys: [],
      describe: { home: '', app: 'Stop in {app}', panel: '' },
    },
    {
      id: 'rew', label: 'Rewind', icon: 'rew', does: 'Rewind', key: 'MediaRewind', altKeys: ['MediaTrackPrevious'], group: 'seek',
      describe: { home: '', app: 'Rewind / fast forward in {app}', panel: '' },
    },
    {
      id: 'ff', label: 'Fast forward', icon: 'ff', does: 'Fast forward', key: 'MediaFastForward', altKeys: ['MediaTrackNext'], group: 'seek',
      describe: { home: '', app: 'Rewind / fast forward in {app}', panel: '' },
    },

    // ---- digits ----------------------------------------------------------------
    ...Array.from({ length: 10 }, (_, n) => ({
      id: `digit${n}`, label: String(n), icon: String(n) as RemoteIconId, does: n === 0 ? 'Sent to the app' : `Open app ${n}`, key: String(n), altKeys: [], group: 'digits',
      describe: { home: 'Jump to app 1–9', app: 'Sent to {app} (YouTube: seek)', panel: 'Jump to app 1–9' },
    })),
    {
      id: 'minus', label: '−', icon: 'minus', does: 'Sent to the app', key: '-', altKeys: ['Minus', 'NumpadSubtract'],
      describe: { home: '', app: '', panel: '' },
    },
  ];
}

/** Fill in "{app}" in a description. */
export function describeFor(b: ButtonDef, context: ButtonContext, appName = 'the app'): string {
  if (appName === 'TIDAL' && context === 'app' && b.group === 'seek') return 'Previous / next track in TIDAL';
  return b.describe[context].replaceAll('{app}', appName);
}

/** The guide's legend: one row per button or group that does something in `context`. */
export interface LegendRow {
  id: string;
  /** Omitted when the symbol would repeat the entire label (E, OK). */
  icon?: RemoteIconId;
  label: string;
  color?: ButtonColor;
  text: string;
  /** Button ids this row covers (for highlighting the drawing). */
  ids: string[];
}

export function legendFor(buttons: ButtonDef[], context: ButtonContext, appName?: string): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const b of buttons) {
    const text = describeFor(b, context, appName);
    if (!text) continue;
    const existing = b.group && rows.find((r) => r.id === b.group);
    if (existing) {
      existing.ids.push(b.id);
      continue;
    }
    const grp = b.group ? GROUPS[b.group] : undefined;
    const icon = grp?.icon ?? b.icon;
    const label = grp?.label ?? b.label;
    rows.push({ id: b.group ?? b.id, icon: (icon === 'e' || icon === 'ok') && icon.toUpperCase() === label ? undefined : icon, label, color: b.color, text, ids: [b.id] });
  }
  return rows;
}

/** Find which button sent `key`: an exact match, or an alternative that deserves a warning. */
export function matchKey(buttons: ButtonDef[], key: string): { button: ButtonDef; exact: boolean } | null {
  const exact = buttons.find((b) => b.key === key);
  if (exact) return { button: exact, exact: true };
  const alt = buttons.find((b) => b.altKeys.includes(key));
  return alt ? { button: alt, exact: false } : null;
}

/**
 * The remote drawing: rows of button ids on a 12-column grid, from the top down.
 * 'ring' is the direction pad with OK in the middle; null is an empty slot.
 */
export const REMOTE_LAYOUT: (string | null)[][] = [
  ['power', null, 'input'],
  ['menu', 'home', 'info'],
  ['ring'],
  ['volUp', 'chUp'],
  ['volDown', 'chDown'],
  ['mute', 'back'],
  ['rew', 'playPause', 'ff'],
  ['record', 'stop'],
  ['red', 'green', 'yellow', 'blue'],
  ['digit1', 'digit2', 'digit3'],
  ['digit4', 'digit5', 'digit6'],
  ['digit7', 'digit8', 'digit9'],
  ['minus', 'digit0', 'e'],
];
