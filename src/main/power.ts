/** Command plans contain argv only; no shell interpolation. */
export interface PowerCommand { file: string; args: string[] }
export function logoutCommand(): PowerCommand {
  return { file: 'qdbus', args: ['org.kde.ksmserver', '/KSMServer', 'logout', '0', '0', '0'] };
}
export function logoutFallback(sessionId: string | undefined): PowerCommand | null {
  return sessionId && /^[a-zA-Z0-9]+$/.test(sessionId)
    ? { file: 'loginctl', args: ['terminate-session', sessionId] }
    : null;
}

/** Injectable runner keeps tests from affecting the real desktop session. */
export async function logOff(sessionId: string | undefined, run: (command: PowerCommand) => Promise<void>): Promise<void> {
  try {
    await run(logoutCommand());
  } catch (error) {
    const fallback = logoutFallback(sessionId);
    if (!fallback) throw error;
    await run(fallback);
  }
}

const SESSION = /^[a-zA-Z0-9]+$/;
const seatOf = (seatPath: string | undefined) =>
  seatPath && /^\/org\/freedesktop\/DisplayManager\/Seat\d{1,3}$/.test(seatPath) ? seatPath : '/org/freedesktop/DisplayManager/Seat0';
const displayManager = (seatPath: string | undefined, ...rest: string[]): PowerCommand =>
  ({ file: 'dbus-send', args: ['--system', '--print-reply', '--dest=org.freedesktop.DisplayManager', seatOf(seatPath), ...rest] });

/** Lock this session (so nobody can get back into it without the password). */
export function lockCommand(sessionId: string | undefined): PowerCommand | null {
  return sessionId && SESSION.test(sessionId) ? { file: 'loginctl', args: ['lock-session', sessionId] } : null;
}
/** Prints "yes" once the desktop has really locked: lock-session itself only asks. */
export function lockedCommand(sessionId: string): PowerCommand {
  return { file: 'loginctl', args: ['show-session', sessionId, '-p', 'LockedHint', '--value'] };
}
export function unlockCommand(sessionId: string): PowerCommand {
  return { file: 'loginctl', args: ['unlock-session', sessionId] };
}
/** Can the display manager (SDDM, LightDM) show its login screen beside this session? Prints "boolean true". */
export function canSwitchCommand(seatPath: string | undefined): PowerCommand {
  return displayManager(seatPath, 'org.freedesktop.DBus.Properties.Get', 'string:org.freedesktop.DisplayManager.Seat', 'string:CanSwitch');
}
/** Ask the display manager for its login screen. This session keeps running. */
export function greeterCommand(seatPath: string | undefined): PowerCommand {
  return displayManager(seatPath, 'org.freedesktop.DisplayManager.Seat.SwitchToGreeter');
}

export interface SwitchDeps {
  /** Runs a command and resolves with what it printed. */
  run: (command: PowerCommand) => Promise<string>;
  wait?: (ms: number) => Promise<void>;
  /** How long the desktop gets to lock before giving up. */
  lockTimeoutMs?: number;
}

/**
 * Switch account: lock this session, then show the system's login screen. The launcher never
 * handles a password; the login screen and the lock do.
 *
 * The session must never be left open behind the login screen, nor left locked with nowhere
 * to go, so: check first that switching is possible, wait until the desktop reports it IS
 * locked (asking is not enough), and unlock again if the login screen then fails to appear.
 */
export async function switchAccount(sessionId: string | undefined, seatPath: string | undefined, deps: SwitchDeps): Promise<void> {
  const lock = lockCommand(sessionId);
  if (!lock || !sessionId) throw new Error('No session to lock');
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!/boolean\s+true/.test(await deps.run(canSwitchCommand(seatPath)))) throw new Error('This computer cannot switch accounts');
  await deps.run(lock);
  const tries = Math.max(1, Math.ceil((deps.lockTimeoutMs ?? 5000) / 250));
  let locked = false;
  for (let i = 0; i < tries && !locked; i++) {
    locked = (await deps.run(lockedCommand(sessionId)).catch(() => '')).trim() === 'yes';
    if (!locked) await wait(250);
  }
  if (!locked) throw new Error('The session did not lock');
  try {
    await deps.run(greeterCommand(seatPath));
  } catch (error) {
    await deps.run(unlockCommand(sessionId)).catch(() => undefined);
    throw error;
  }
}
