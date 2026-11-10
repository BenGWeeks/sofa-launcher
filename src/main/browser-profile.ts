import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** Enable our unpacked extension only in a stopped, dedicated Sofa profile.
 * Never edit preferences held by the browser, or touch its ordinary/default profile.
 */
export function prepareRemoteProfile(profile: string, extensionPath?: string): void {
  const prefsPath = join(profile, 'Default', 'Preferences');
  let prefs: Record<string, any> = {};
  if (existsSync(prefsPath)) prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
  if (!prefs || Array.isArray(prefs) || typeof prefs !== 'object') throw new Error('Invalid browser preferences');
  const obsolete: string[] = [];
  if (extensionPath) for (const [id, value] of Object.entries(prefs.extensions?.settings ?? {})) {
    const path = (value as { path?: unknown })?.path;
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) === resolve(extensionPath)) continue;
    let ours = false;
    try { ours = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')).name === 'Sofa remote navigation'; }
    catch { ours = path === '/opt/sofa-launcher/resources/browser-remote' || /^\/tmp\/sofa-(?:remote-|emulation)/.test(path); }
    if (ours) obsolete.push(id);
  }
  if (prefs.extensions?.ui?.developer_mode === true && obsolete.length === 0) return;
  try {
    const lock = join(profile, 'SingletonLock');
    lstatSync(lock);
    // A symlink may be dangling, so existsSync alone is insufficient here.
    const target = readlinkSync(lock);
    const pid = target.startsWith(`${hostname()}-`) ? Number(target.slice(hostname().length + 1)) : NaN;
    let stale = false;
    if (Number.isSafeInteger(pid) && pid > 1) {
      try { process.kill(pid, 0); } catch (error) { stale = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }
    if (!stale) throw new Error('Close this Sofa browser profile completely before enabling remote navigation');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  prefs.extensions ??= {};
  prefs.extensions.ui ??= {};
  prefs.extensions.ui.developer_mode = true;
  for (const id of obsolete) delete prefs.extensions.settings[id];
  mkdirSync(join(profile, 'Default'), { recursive: true, mode: 0o700 });
  const temp = `${prefsPath}.sofa-${process.pid}`;
  writeFileSync(temp, JSON.stringify(prefs), { mode: 0o600, flag: 'wx' });
  renameSync(temp, prefsPath);
}
