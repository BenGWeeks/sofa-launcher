/**
 * Pause the app being left, over MPRIS (D-Bus). Uses `gdbus` with argument
 * arrays; no native dependency. A player is matched to a window by PID:
 * the bus name's connection PID must be the window's _NET_WM_PID or a
 * descendant of it (a browser's MPRIS owner can be a child process).
 *
 * Flatpak apps live in their own PID namespace behind xdg-dbus-proxy, so PIDs
 * don't line up. For them the player is matched by bus-name suffix, by its
 * DesktopEntry property, or via `flatpak ps` (the instance's host PIDs).
 * Everything is best effort and silent on failure.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import type { WindowManager } from './windows';

const execFileP = promisify(execFile);

export interface PauseHints {
  /** Rechecked after asynchronous discovery, immediately before sending Pause. */
  shouldPause?: () => boolean;
  /** The flatpak application id (e.g. org.jellyfin.JellyfinDesktop) when the app runs in flatpak. */
  flatpakId?: string;
}

export type TransportCommand = 'PlayPause' | 'Stop' | 'Next' | 'Previous';

export interface MediaController {
  controlWindow(windowId: string, command: TransportCommand, hints?: PauseHints): Promise<boolean>;
  /** Pause whatever MPRIS player belongs to this X11 window. Resolves to true if one was paused. */
  pauseWindow(windowId: string, hints?: PauseHints): Promise<boolean>;
}

export type Runner = (file: string, args: string[]) => Promise<string>;

const defaultRunner: Runner = async (file, args) => (await execFileP(file, args, { timeout: 3000 })).stdout;

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const BUS_NAME_RE = /^[A-Za-z0-9._-]+$/;
const FLATPAK_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Parse gdbus' GVariant text output of ListNames: (['a', 'b', ...],) */
export function parseBusNames(stdout: string): string[] {
  return [...stdout.matchAll(/'([^']+)'/g)].map((m) => m[1]!).filter((n) => BUS_NAME_RE.test(n));
}

/** Parse "(uint32 1234,)" → 1234. */
export function parsePid(stdout: string): number | null {
  const m = stdout.match(/uint32\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Parse a Properties.Get string result: (<'org.jellyfin.JellyfinDesktop'>,) */
export function parseStringProperty(stdout: string): string | null {
  const m = stdout.match(/'([^']*)'/);
  return m ? m[1]! : null;
}

/** `flatpak ps --columns=application,pid,child-pid`: host PIDs of the instances running `appId`. */
export function parseFlatpakPs(stdout: string, appId: string): number[] {
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const [application, ...rest] = line.trim().split(/\s+/);
    if (application !== appId) continue;
    for (const p of rest) if (/^\d+$/.test(p)) pids.push(Number(p));
  }
  return pids;
}

/** Parent PID from /proc/<pid>/stat (field 4, after the parenthesised command name). */
export function parentPidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const ppid = stat.slice(close + 2).split(' ')[1];
  return ppid && /^\d+$/.test(ppid) ? Number(ppid) : null;
}

function readPpid(pid: number): number | null {
  try {
    return parentPidFromStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

/** Is `pid` equal to `ancestor`, or somewhere below it in the process tree? */
export function isSameOrDescendant(pid: number, ancestor: number, ppidOf: (pid: number) => number | null, maxDepth = 16): boolean {
  let p: number | null = pid;
  for (let i = 0; i <= maxDepth && p !== null && p > 1; i++) {
    if (p === ancestor) return true;
    p = ppidOf(p);
  }
  return false;
}

/** Does an MPRIS bus name look like it belongs to this flatpak app (e.g. ...MediaPlayer2.org.jellyfin.JellyfinDesktop)? */
export function busNameMatchesFlatpak(name: string, flatpakId: string): boolean {
  const suffix = name.slice(MPRIS_PREFIX.length).toLowerCase();
  const id = flatpakId.toLowerCase();
  const last = id.split('.').at(-1) ?? id;
  return suffix === id || suffix.startsWith(`${id}.`) || suffix === last || suffix.startsWith(`${last}.`);
}

export class GdbusMediaController implements MediaController {
  constructor(
    private readonly wm: Pick<WindowManager, 'pidOf'>,
    private readonly run: Runner = defaultRunner,
    private readonly ppidOf: (pid: number) => number | null = readPpid,
  ) {}

  private dbus(method: string, ...args: string[]): Promise<string> {
    return this.run('gdbus', [
      'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', `org.freedesktop.DBus.${method}`, ...args,
    ]);
  }

  private player(name: string, method: string, ...args: string[]): Promise<string> {
    return this.run('gdbus', ['call', '--session', '--dest', name, '--object-path', '/org/mpris/MediaPlayer2', '--method', method, ...args]);
  }

  private async connectionPid(name: string): Promise<number | null> {
    return parsePid(await this.dbus('GetConnectionUnixProcessID', name).catch(() => ''));
  }

  private async matchByPid(names: string[], ancestors: number[]): Promise<string | null> {
    for (const name of names) {
      const pid = await this.connectionPid(name);
      if (pid !== null && ancestors.some((a) => isSameOrDescendant(pid, a, this.ppidOf))) return name;
    }
    return null;
  }

  private async matchFlatpak(names: string[], flatpakId: string): Promise<string | null> {
    if (!FLATPAK_ID_RE.test(flatpakId)) return null;
    const byName = names.find((n) => busNameMatchesFlatpak(n, flatpakId));
    if (byName) return byName;
    for (const name of names) {
      const entry = parseStringProperty(
        await this.player(name, 'org.freedesktop.DBus.Properties.Get', 'org.mpris.MediaPlayer2', 'DesktopEntry').catch(() => ''),
      );
      if (entry && entry.toLowerCase() === flatpakId.toLowerCase()) return name;
    }
    const hostPids = parseFlatpakPs(await this.run('flatpak', ['ps', '--columns=application,pid,child-pid']).catch(() => ''), flatpakId);
    return hostPids.length ? this.matchByPid(names, hostPids) : null;
  }

  async pauseWindow(windowId: string, hints: PauseHints = {}): Promise<boolean> {
    return this.commandWindow(windowId, 'Pause', hints);
  }

  async controlWindow(windowId: string, command: TransportCommand, hints: PauseHints = {}): Promise<boolean> {
    if (!['PlayPause', 'Stop', 'Next', 'Previous'].includes(command)) return false;
    return this.commandWindow(windowId, command, hints);
  }

  private async commandWindow(windowId: string, command: string, hints: PauseHints): Promise<boolean> {
    try {
      const names = parseBusNames(await this.dbus('ListNames')).filter((n) => n.startsWith(MPRIS_PREFIX));
      if (names.length === 0) return false;
      let target: string | null;
      if (hints.flatpakId) {
        target = await this.matchFlatpak(names, hints.flatpakId);
      } else {
        const windowPid = await this.wm.pidOf(windowId);
        target = windowPid ? await this.matchByPid(names, [windowPid]) : null;
      }
      if (!target || hints.shouldPause?.() === false) return false;
      await this.player(target, `org.mpris.MediaPlayer2.Player.${command}`);
      return true;
    } catch {
      return false; // best effort
    }
  }
}

export class FakeMediaController implements MediaController {
  async controlWindow(_windowId: string, _command: TransportCommand): Promise<boolean> { return true; }
  paused: { windowId: string; hints: PauseHints }[] = [];
  async pauseWindow(windowId: string, hints: PauseHints = {}): Promise<boolean> {
    if (hints.shouldPause?.() === false) return false;
    const { shouldPause: _guard, ...recordedHints } = hints;
    this.paused.push({ windowId, hints: recordedHints });
    return true;
  }
}
