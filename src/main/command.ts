/**
 * The local control command: `sofa-launcher open <appId> [--search "<text>"]`.
 * A second instance hands its argv to the running one (Electron's single-instance
 * lock), which parses it here. Everything is validated before it reaches a spawn.
 *
 * Chromium rewrites argv before it reaches us: `--switches` are moved ahead of
 * positional arguments (so `open netflix --search "x"` arrives as
 * `--search open netflix x`). The parser therefore reads switches and
 * positionals separately and never relies on their relative order.
 */
import type { ResolvedApp } from './config';

export const MAX_SEARCH = 200;
const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const USAGE = 'Usage: sofa-launcher open <appId> [--search "<text>"]';

export type OpenCommand = { appId: string; search?: string };
export type ParsedCommand = { ok: true; command: OpenCommand } | { ok: false; error: string } | null;

/** Remove control characters (incl. newlines) and trim; never longer than MAX_SEARCH. */
export function sanitizeSearch(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return clean.length === 0 || clean.length > MAX_SEARCH ? null : clean;
}

/**
 * Find an `open` command in a process argv. Anything before the `open` word
 * (electron binary, app path) and the launcher's own `--flags` are ignored.
 * Returns null when there is no command, so a plain second launch still just shows Home.
 */
export function parseOpenCommand(argv: string[]): ParsedCommand {
  const positionals = argv.filter((a) => !a.startsWith('--'));
  const switches = argv.filter((a) => a.startsWith('--'));
  const at = positionals.indexOf('open');
  if (at < 0) return null;
  const [appId, ...rest] = positionals.slice(at + 1);
  if (!appId) return { ok: false, error: USAGE };
  if (!APP_ID_RE.test(appId)) return { ok: false, error: `Invalid app id: ${appId.slice(0, 40)}` };
  const command: OpenCommand = { appId };

  const inline = switches.find((s) => s.startsWith('--search='));
  const bare = switches.includes('--search');
  let text: string | undefined;
  if (inline) text = inline.slice('--search='.length);
  else if (bare) text = rest.join(' '); // the value was split off from its switch
  else if (rest.length) return { ok: false, error: `Unknown argument: ${rest[0]!.slice(0, 40)}` };
  if (inline && rest.length) return { ok: false, error: `Unknown argument: ${rest[0]!.slice(0, 40)}` };

  if (text !== undefined) {
    const clean = sanitizeSearch(text);
    if (clean === null) return { ok: false, error: `--search must be 1–${MAX_SEARCH} printable characters` };
    command.search = clean;
  }
  return { ok: true, command };
}

/**
 * Re-validate a ParsedCommand that arrived from a second instance (additionalData of the
 * single-instance lock). Never trusts the other process: same rules as parseOpenCommand.
 */
export function validateOpenCommand(data: unknown): ParsedCommand {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object') return { ok: false, error: USAGE };
  const d = data as { ok?: unknown; error?: unknown; command?: unknown };
  if (d.ok === false) return { ok: false, error: typeof d.error === 'string' ? d.error.slice(0, 200) : USAGE };
  const c = (d.command ?? {}) as { appId?: unknown; search?: unknown };
  if (typeof c.appId !== 'string' || !APP_ID_RE.test(c.appId)) return { ok: false, error: USAGE };
  const command: OpenCommand = { appId: c.appId };
  if (c.search !== undefined) {
    const clean = typeof c.search === 'string' ? sanitizeSearch(c.search) : null;
    if (clean === null) return { ok: false, error: `--search must be 1–${MAX_SEARCH} printable characters` };
    command.search = clean;
  }
  return { ok: true, command };
}

/** The app's search results page for `text`, or null if it has no search URL. */
export function searchUrl(app: Pick<ResolvedApp, 'searchUrl'>, text: string): string | null {
  const clean = sanitizeSearch(text);
  if (!app.searchUrl || clean === null) return null;
  return app.searchUrl + encodeURIComponent(clean);
}
