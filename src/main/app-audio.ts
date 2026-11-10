import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { isSameOrDescendant, parentPidFromStat, type Runner } from './mpris';
export interface AppAudioState { available: boolean; volume: number; muted: boolean }
export type AudioAction = 'get' | 'up' | 'down' | 'mute';
const exec = promisify(execFile);
const runner: Runner = async (file, args) => (await exec(file, args, { timeout: 3000, maxBuffer: 1_000_000 })).stdout;
interface Stream { index: number; mute: boolean; volume: Record<string, { value: number }>; properties: Record<string, string> }
export class AppAudio {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private run: Runner = runner, private parent = (pid: number): number | null => {
    try { return parentPidFromStat(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return null; }
  }) {}
  control(pid: number, flatpakId: string | undefined, action: AudioAction, valid = () => true): Promise<AppAudioState> {
    const operation = async () => {
      const streams = JSON.parse(await this.run('pactl', ['-f', 'json', 'list', 'sink-inputs'])) as Stream[];
      const matches = streams.filter(s => {
        const p = s.properties ?? {};
        const audioPid = Number(p['application.process.id']);
        return (flatpakId && [p['application.id'], p['flatpak.app-id']].includes(flatpakId)) ||
          (Number.isSafeInteger(audioPid) && audioPid > 1 && isSameOrDescendant(audioPid, pid, this.parent));
      }).filter(s => Number.isSafeInteger(s.index) && s.index >= 0 && typeof s.mute === 'boolean');
      if (!matches.length || !valid()) return { available: false, volume: 0, muted: false };
      const mute = !matches.every(s => s.mute);
      for (const s of matches) {
        if (!valid()) return { available: false, volume: 0, muted: false };
        if (action === 'mute') {
          await this.run('pactl', ['set-sink-input-mute', String(s.index), mute ? '1' : '0']);
          s.mute = mute;
        } else if (action === 'up' || action === 'down') {
          const channels = Object.values(s.volume);
          if (!channels.length || channels.some(c => !Number.isFinite(c.value) || c.value < 0)) throw new Error('Invalid app audio volume');
          const next = channels.map(c => Math.round(Math.max(0, Math.min(65536, c.value + (action === 'up' ? 3277 : -3277)))));
          await this.run('pactl', ['set-sink-input-volume', String(s.index), ...next.map(String)]);
          channels.forEach((c, i) => c.value = next[i]!);
        }
      }
      const levels = matches.flatMap(s => Object.values(s.volume).map(c => c.value));
      return { available: true, volume: Math.round(Math.max(0, ...levels) / 65536 * 100), muted: matches.every(s => s.mute) };
    };
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
