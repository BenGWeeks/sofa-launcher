import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Runner, TransportCommand } from './mpris';

const exec = promisify(execFile);
const runDefault: Runner = async (file, args) => (await exec(file, args, { timeout: 3000 })).stdout;
export const TRANSPORT_KEYS = [
  ['MediaPlayPause', 'PlayPause', 'playpausemedia', 'Play/Pause media playback'],
  ['MediaStop', 'Stop', 'stopmedia', 'Stop media playback'],
  ['MediaNextTrack', 'Next', 'nextmedia', 'Media playback next'],
  ['MediaPreviousTrack', 'Previous', 'previousmedia', 'Media playback previous'],
] as const;
type Entry = { action: string[]; keys: number[] };
export function parseShortcutKeys(value: string): number[] {
  const match = value.match(/^\(\s*(?:@ai\s*)?\[([\d,\s]*)\],\s*\)\s*$/);
  if (!match) throw new Error('Invalid desktop shortcut response');
  return match[1]!.trim() ? match[1]!.split(',').map(value => Number(value.trim())) : [];
}

/** Temporarily own transport keys; preserve KDE's exact original bindings.
 * The journal is written before changes, so a crash can be recovered on restart
 * or with --undo-user-setup. Volume shortcuts are never changed here.
 */
export class DesktopMediaKeys {
  private ready = false;
  private claimed: string[] = [];
  private restoring?: Promise<void>;
  constructor(private file: string, private shortcuts: { register(key: string, callback: () => void): boolean; unregister(key: string): void }, private run: Runner = runDefault) {}
  private call(method: string, ...args: string[]) { return this.run('gdbus', ['call', '--session', '--dest', 'org.kde.kglobalaccel', '--object-path', '/kglobalaccel', '--method', `org.kde.KGlobalAccel.${method}`, ...args]); }
  private read(): Entry[] {
    const entries: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!Array.isArray(entries) || entries.length !== TRANSPORT_KEYS.length || entries.some((e, i) => JSON.stringify(e.action) !== JSON.stringify(['mediacontrol', TRANSPORT_KEYS[i]![2], 'Media Controller', TRANSPORT_KEYS[i]![3]]) || !Array.isArray(e.keys) || e.keys.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) < 0 || Number(n) > 0x7fffffff))) throw new Error('Invalid saved desktop shortcuts');
    return entries;
  }
  async prepare(): Promise<boolean> {
    // A desktop without KDE has no competing Media Controller to release.
    try { await this.call('allComponents'); } catch { this.ready = true; return true; }
    try {
      if (!existsSync(this.file)) {
        const entries: Entry[] = [];
        for (const [, , id, label] of TRANSPORT_KEYS) {
          const action = ['mediacontrol', id, 'Media Controller', label];
          entries.push({ action, keys: parseShortcutKeys(await this.call('shortcut', JSON.stringify(action))) });
        }
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        writeFileSync(this.file, JSON.stringify(entries), { mode: 0o600, flag: 'wx' });
      }
      for (const entry of this.read()) {
        await this.call('setForeignShortcut', JSON.stringify(entry.action), '[]');
        if (parseShortcutKeys(await this.call('shortcut', JSON.stringify(entry.action))).length) throw new Error('Desktop still owns transport');
      }
      this.ready = true;
      return true;
    } catch { await this.restore().catch(() => {}); return false; }
  }
  register(callback: (command: TransportCommand) => void): boolean {
    this.claimed = [];
    if (!this.ready) return false;
    for (const [key, command] of TRANSPORT_KEYS) {
      if (!this.shortcuts.register(key, () => callback(command))) {
        for (const claimed of this.claimed) this.shortcuts.unregister(claimed);
        this.claimed = [];
        void this.restore().catch(() => {});
        return false;
      }
      this.claimed.push(key);
    }
    return true;
  }
  restore(): Promise<void> {
    return this.restoring ??= this.doRestore().finally(() => { this.restoring = undefined; });
  }
  private async doRestore(): Promise<void> {
    this.ready = false;
    for (const key of this.claimed.splice(0)) this.shortcuts.unregister(key);
    if (!existsSync(this.file)) return;
    for (const entry of this.read()) {
      // Respect a shortcut the user changed while Sofa was running.
      if (parseShortcutKeys(await this.call('shortcut', JSON.stringify(entry.action))).length === 0) await this.call('setForeignShortcut', JSON.stringify(entry.action), JSON.stringify(entry.keys));
    }
    unlinkSync(this.file);
  }
  async desktopFallback(command: TransportCommand): Promise<void> {
    const action = TRANSPORT_KEYS.find(entry => entry[1] === command)?.[2];
    if (action) await this.run('gdbus', ['call','--session','--dest','org.kde.kglobalaccel','--object-path','/component/mediacontrol','--method','org.kde.kglobalaccel.Component.invokeShortcut',action]);
  }
}
