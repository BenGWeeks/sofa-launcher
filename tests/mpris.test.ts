import { describe, expect, it } from 'vitest';
import {
  busNameMatchesFlatpak, GdbusMediaController, isSameOrDescendant, parseBusNames, parseFlatpakPs, parentPidFromStat, parsePid, parseStringProperty,
} from '../src/main/mpris';
import { FakeWindowManager } from '../src/main/windows';

describe('gdbus output parsing', () => {
  it('reads bus names out of GVariant text', () => {
    const out = "(['org.freedesktop.DBus', 'org.mpris.MediaPlayer2.chromium.instance1234', ':1.42'],)\n";
    expect(parseBusNames(out)).toEqual(['org.freedesktop.DBus', 'org.mpris.MediaPlayer2.chromium.instance1234']); // unique names (:1.42) are dropped
  });
  it('reads a uint32 pid', () => {
    expect(parsePid('(uint32 4321,)\n')).toBe(4321);
    expect(parsePid('error')).toBeNull();
  });
  it('reads the parent pid from /proc/<pid>/stat even when the command name has spaces and parens', () => {
    expect(parentPidFromStat('4321 (msedge (renderer)) S 4000 4000 4000 0 -1 4194560 1 0')).toBe(4000);
    expect(parentPidFromStat('garbage')).toBeNull();
  });
});

describe('flatpak matching helpers', () => {
  it('matches bus names by flatpak id or its last segment', () => {
    expect(busNameMatchesFlatpak('org.mpris.MediaPlayer2.org.jellyfin.JellyfinDesktop', 'org.jellyfin.JellyfinDesktop')).toBe(true);
    expect(busNameMatchesFlatpak('org.mpris.MediaPlayer2.jellyfindesktop.instance12', 'org.jellyfin.JellyfinDesktop')).toBe(true);
    expect(busNameMatchesFlatpak('org.mpris.MediaPlayer2.chromium.instance1', 'org.jellyfin.JellyfinDesktop')).toBe(false);
  });
  it('reads host pids out of flatpak ps', () => {
    const out = 'org.jellyfin.JellyfinDesktop\t4000\t4001\norg.mozilla.firefox\t5000\t5001\n';
    expect(parseFlatpakPs(out, 'org.jellyfin.JellyfinDesktop')).toEqual([4000, 4001]);
    expect(parseFlatpakPs(out, 'org.other')).toEqual([]);
  });
  it('reads a string property', () => {
    expect(parseStringProperty("(<'org.jellyfin.JellyfinDesktop'>,)")).toBe('org.jellyfin.JellyfinDesktop');
    expect(parseStringProperty('error')).toBeNull();
  });
});

describe('isSameOrDescendant', () => {
  const tree: Record<number, number> = { 50: 40, 40: 30, 30: 1 };
  const ppid = (p: number) => tree[p] ?? null;
  it('matches the pid itself and its ancestors', () => {
    expect(isSameOrDescendant(30, 30, ppid)).toBe(true);
    expect(isSameOrDescendant(50, 30, ppid)).toBe(true);
    expect(isSameOrDescendant(30, 50, ppid)).toBe(false);
    expect(isSameOrDescendant(50, 99, ppid)).toBe(false);
  });
  it('gives up on a cyclic or very deep chain', () => {
    expect(isSameOrDescendant(5, 6, () => 5)).toBe(false);
  });
});

describe('GdbusMediaController', () => {
  function setup(players: Record<string, number>, tree: Record<number, number>, extra: { desktopEntry?: Record<string, string>; flatpakPs?: string } = {}) {
    const wm = new FakeWindowManager();
    const calls: string[][] = [];
    const run = async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      if (file === 'flatpak') return extra.flatpakPs ?? '';
      const method = args[args.indexOf('--method') + 1];
      if (method === 'org.freedesktop.DBus.ListNames') return `([${Object.keys(players).map((n) => `'${n}'`).join(', ')}],)`;
      if (method === 'org.freedesktop.DBus.GetConnectionUnixProcessID') return `(uint32 ${players[args.at(-1)!]},)`;
      if (method === 'org.freedesktop.DBus.Properties.Get') {
        const dest = args[args.indexOf('--dest') + 1]!;
        return extra.desktopEntry?.[dest] ? `(<'${extra.desktopEntry[dest]}'>,)` : '()';
      }
      return '()';
    };
    const ctl = new GdbusMediaController(wm, run, (p) => tree[p] ?? null);
    return { wm, ctl, calls };
  }

  it('pauses the player whose process is a child of the window process', async () => {
    const { wm, ctl, calls } = setup(
      { 'org.mpris.MediaPlayer2.chromium.instance100': 110, 'org.mpris.MediaPlayer2.jellyfin': 200, 'org.kde.Other': 1 },
      { 110: 100, 100: 1, 200: 1 },
    );
    wm.pids.set('7', 100);
    expect(await ctl.pauseWindow('7')).toBe(true);
    const pause = calls.find((c) => c.includes('org.mpris.MediaPlayer2.Player.Pause'))!;
    expect(pause).toContain('org.mpris.MediaPlayer2.chromium.instance100');
    expect(calls.filter((c) => c.includes('org.mpris.MediaPlayer2.Player.Pause'))).toHaveLength(1);
  });

  it('routes transport only to the selected window, leaving other players untouched', async () => {
    const { wm, ctl, calls } = setup({ 'org.mpris.MediaPlayer2.youtube': 200, 'org.mpris.MediaPlayer2.tidal': 100 }, {100:1,200:1});
    wm.pids.set('7',100);
    for (const command of ['PlayPause','Stop','Next','Previous'] as const) expect(await ctl.controlWindow('7',command)).toBe(true);
    const transport = calls.filter(c => c.some(arg => /^org.mpris.MediaPlayer2.Player./.test(arg)));
    expect(transport).toHaveLength(4);
    expect(transport.every(c => c.includes('org.mpris.MediaPlayer2.tidal'))).toBe(true);
  });

  it('pauses nothing when no player matches, and swallows failures', async () => {
    const { wm, ctl, calls } = setup({ 'org.mpris.MediaPlayer2.jellyfin': 200 }, { 200: 1 });
    wm.pids.set('7', 100);
    expect(await ctl.pauseWindow('7')).toBe(false);
    expect(calls.some((c) => c.includes('org.mpris.MediaPlayer2.Player.Pause'))).toBe(false);
    const failing = new GdbusMediaController(wm, async () => { throw new Error('no bus'); });
    expect(await failing.pauseWindow('7')).toBe(false);
  });

  it('matches flatpak apps by DesktopEntry when the bus name gives nothing away', async () => {
    const { wm, ctl, calls } = setup(
      { 'org.mpris.MediaPlayer2.mpv': 7777, 'org.mpris.MediaPlayer2.chromium.instance1': 100 },
      {},
      { desktopEntry: { 'org.mpris.MediaPlayer2.mpv': 'org.jellyfin.JellyfinDesktop' } },
    );
    wm.pids.set('9', 1); // the window pid is useless for a flatpak app
    expect(await ctl.pauseWindow('9', { flatpakId: 'org.jellyfin.JellyfinDesktop' })).toBe(true);
    expect(calls.find((c) => c.includes('org.mpris.MediaPlayer2.Player.Pause'))).toContain('org.mpris.MediaPlayer2.mpv');
  });

  it('falls back to flatpak ps host pids', async () => {
    const { ctl, calls } = setup(
      { 'org.mpris.MediaPlayer2.mpv': 4010 },
      { 4010: 4001, 4001: 4000, 4000: 1 },
      { flatpakPs: 'org.jellyfin.JellyfinDesktop\t4000\t4001\n' },
    );
    expect(await ctl.pauseWindow('9', { flatpakId: 'org.jellyfin.JellyfinDesktop' })).toBe(true);
    expect(calls.some((c) => c[0] === 'flatpak' && c.includes('ps'))).toBe(true);
    expect(await ctl.pauseWindow('9', { flatpakId: 'org.other.App' })).toBe(false);
  });

  it('does nothing for a window without a pid, and nothing at all when no player is on the bus', async () => {
    const { ctl, calls } = setup({ 'org.mpris.MediaPlayer2.x': 5 }, { 5: 1 });
    expect(await ctl.pauseWindow('404')).toBe(false);
    expect(calls.some((c) => c.includes('org.mpris.MediaPlayer2.Player.Pause'))).toBe(false);
    const empty = setup({}, {});
    expect(await empty.ctl.pauseWindow('404')).toBe(false);
    expect(empty.calls).toHaveLength(1); // just ListNames
  });
});

describe('pause navigation guard', () => {
  it('rechecks permission after asynchronous player discovery, immediately before Pause', async () => {
    const wm = new FakeWindowManager();
    wm.pids.set('7', 100);
    let allowed = true;
    const calls: string[][] = [];
    const ctl = new GdbusMediaController(wm, async (_file, args) => {
      calls.push(args);
      if (args.includes('org.freedesktop.DBus.ListNames')) return "(['org.mpris.MediaPlayer2.test'],)";
      if (args.includes('org.freedesktop.DBus.GetConnectionUnixProcessID')) {
        allowed = false; // user returned to this player during the D-Bus lookup
        return '(uint32 100,)';
      }
      return '()';
    });
    expect(await ctl.pauseWindow('7', { shouldPause: () => allowed })).toBe(false);
    expect(calls.some((args) => args.includes('org.mpris.MediaPlayer2.Player.Pause'))).toBe(false);
  });
});
