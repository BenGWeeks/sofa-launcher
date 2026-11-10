import { describe, it, expect, vi } from 'vitest';
import { AppAudio } from '../src/main/app-audio';
const stream = (index: number, pid: number, value = 32768) => ({ index, mute: false, volume: { left: { value }, right: { value } }, properties: { 'application.process.id': String(pid) } });
describe('independent app audio', () => {
  it('changes only the selected process tree, preserving main/system audio', async () => {
    const run = vi.fn(async (_f, args: string[]) => args.includes('list') ? JSON.stringify([stream(1, 11), stream(2, 22)]) : '');
    const audio = new AppAudio(run, pid => pid === 22 ? 20 : null);
    expect(await audio.control(20, undefined, 'down')).toMatchObject({ volume: 45, available: true });
    expect(run.mock.calls[1]?.[1]).toEqual(['set-sink-input-volume', '2', '29491', '29491']);
  });
  it('mutes only a matching Flatpak stream and never guesses from app names', async () => {
    const target = { ...stream(3, 4), properties: { 'application.id': 'org.jellyfin.JellyfinDesktop' } };
    const run = vi.fn(async (_f, args: string[]) => args.includes('list') ? JSON.stringify([target, stream(4, 55)]) : '');
    expect(await new AppAudio(run).control(99, 'org.jellyfin.JellyfinDesktop', 'mute')).toMatchObject({ muted: true });
    expect(run.mock.calls[1]?.[1]).toEqual(['set-sink-input-mute', '3', '1']);
  });
  it('does not change anything after the selected pair changes or when there is no stream', async () => {
    const run = vi.fn(async () => JSON.stringify([stream(1, 20)]));
    expect((await new AppAudio(run).control(20, undefined, 'up', () => false)).available).toBe(false);
    expect((await new AppAudio(run).control(99, undefined, 'mute')).available).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('caps individual channels at 100 percent', async () => {
    const run = vi.fn(async (_f, args: string[]) => args.includes('list') ? JSON.stringify([stream(1, 20, 65536)]) : '');
    expect((await new AppAudio(run).control(20, undefined, 'up')).volume).toBe(100);
  });
});
