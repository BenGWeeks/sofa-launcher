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

/** Lock this session (so nobody can get back into it without the password). */
export function lockCommand(sessionId: string | undefined): PowerCommand | null {
  return sessionId && /^[a-zA-Z0-9]+$/.test(sessionId) ? { file: 'loginctl', args: ['lock-session', sessionId] } : null;
}

/** Ask the display manager (SDDM, LightDM) for its login screen. This session keeps running. */
export function greeterCommand(seatPath: string | undefined): PowerCommand {
  const seat = seatPath && /^\/org\/freedesktop\/DisplayManager\/Seat\d{1,3}$/.test(seatPath) ? seatPath : '/org/freedesktop/DisplayManager/Seat0';
  return {
    file: 'dbus-send',
    args: ['--system', '--print-reply', '--dest=org.freedesktop.DisplayManager', seat, 'org.freedesktop.DisplayManager.Seat.SwitchToGreeter'],
  };
}

/**
 * Switch account: lock this session, then show the system's login screen. The launcher never
 * handles a password; the login screen and the lock do. If the session cannot be locked,
 * nothing is switched: it must not be left open behind the login screen.
 */
export async function switchAccount(sessionId: string | undefined, seatPath: string | undefined, run: (command: PowerCommand) => Promise<void>): Promise<void> {
  const lock = lockCommand(sessionId);
  if (!lock) throw new Error('No session to lock');
  await run(lock);
  await run(greeterCommand(seatPath));
}
