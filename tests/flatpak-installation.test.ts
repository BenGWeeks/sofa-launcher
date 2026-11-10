import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }));
import { execFile } from 'node:child_process';
import { AppManager } from '../src/main/apps';
import { parseConfig } from '../src/main/config';
import { FakeWindowManager } from '../src/main/windows';

describe('Flatpak installation probe', () => {
  it.each([true, false])('uses flatpak info exit status (success=%s)', async (success) => {
    vi.mocked(execFile).mockImplementation(((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, stdout: string) => void) => {
      cb(success ? null : new Error('not installed'), '');
    }) as never);
    const mgr = new AppManager(parseConfig('[[apps]]\nid="jellyfin"\ncatalogue="jellyfin"').apps, new FakeWindowManager(), {
      dataDir: '/d', isExecutable: () => true,
    });
    expect((await mgr.states())[0]?.installed).toBe(success);
    expect(execFile).toHaveBeenLastCalledWith('flatpak', ['info', 'org.jellyfin.JellyfinDesktop'], { timeout: 5000 }, expect.any(Function));
  });
});
