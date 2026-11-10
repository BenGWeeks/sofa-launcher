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
