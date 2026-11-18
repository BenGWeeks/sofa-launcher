import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, cb) => cb(null, { stdout: '42\n', stderr: '' })),
}));
// Use a promisified-compatible fake to inspect the actual command, without X11.
vi.mock('node:util', () => ({ promisify: (fn: unknown) => fn }));
import { execFile } from 'node:child_process';
import { XdotoolWindowManager } from '../src/main/windows';

describe('window class search', () => {
  it('waits for X11 focus acknowledgment with a bounded timeout', async () => {
    vi.mocked(execFile).mockImplementation((async () => ({ stdout: '' })) as never);
    await new XdotoolWindowManager().activate('123');
    expect(execFile).toHaveBeenCalledWith('xdotool', ['windowactivate', '--sync', '123'], { timeout: 2000 });
  });
  it.each(['utility', 'notification'] as const)('sets the %s type only for a validated native window', async (type) => {
    vi.mocked(execFile).mockImplementation((async () => ({ stdout: '' })) as never);
    const wm = new XdotoolWindowManager();
    await wm.setType('123', type);
    expect(execFile).toHaveBeenCalledWith('xprop', ['-id', '123', '-f', '_NET_WM_WINDOW_TYPE', '32a', '-set', '_NET_WM_WINDOW_TYPE', type === 'utility' ? '_NET_WM_WINDOW_TYPE_UTILITY' : '_NET_WM_WINDOW_TYPE_NOTIFICATION'], { timeout: 2000 });
    await expect(wm.setType('invalid', type)).rejects.toThrow('Invalid');
  });
  it('parents an overlay to the app it covers, clears it, and rejects invalid or self targets', async () => {
    vi.mocked(execFile).mockClear();
    vi.mocked(execFile).mockImplementation((async () => ({ stdout: '' })) as never);
    const wm = new XdotoolWindowManager();
    await wm.setTransientFor('123', '456');
    await wm.setTransientFor('123', null);
    const calls = vi.mocked(execFile).mock.calls.map(call => [call[0], (call[1] as string[]).slice(-2)]);
    expect(calls).toEqual([['python3', ['123', '456']], ['python3', ['123', '0']]]);
    expect((vi.mocked(execFile).mock.calls[0]![1] as string[])[2]).toContain('XSetTransientForHint');
    await expect(wm.setTransientFor('123', '123')).rejects.toThrow('Invalid');
    await expect(wm.setTransientFor('123', '0x1; rm')).rejects.toThrow('Invalid');
    await expect(wm.setTransientFor('nope', '456')).rejects.toThrow('Invalid');
  });
  it('anchors and escapes dots so a class cannot match a different app', async () => {
    vi.mocked(execFile).mockImplementation((async () => ({ stdout: '42\n' })) as never);
    expect(await new XdotoolWindowManager().findByClass('org.example.App')).toEqual(['42']);
    expect(execFile).toHaveBeenCalledWith('xdotool', ['search', '--onlyvisible', '--class', '^org\\.example\\.App$']);
  });
  it('finds a minimised window when none is visible, ignoring unmapped helper windows', async () => {
    vi.mocked(execFile).mockClear();
    vi.mocked(execFile).mockImplementation((async (file: string, args: string[]) => {
      if (file === 'xdotool') return { stdout: args.includes('--onlyvisible') ? '' : '7\n8\n' };
      return { stdout: args[1] === '8' ? '_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_VERT, _NET_WM_STATE_HIDDEN' : '_NET_WM_STATE:  not found.' };
    }) as never);
    expect(await new XdotoolWindowManager().findByClass('sofa-youtube')).toEqual(['8']);
  });
  it('prefers visible windows without probing the others', async () => {
    vi.mocked(execFile).mockClear();
    vi.mocked(execFile).mockImplementation((async () => ({ stdout: '42\n' })) as never);
    expect(await new XdotoolWindowManager().findByClass('sofa-youtube')).toEqual(['42']);
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it('asks for full screen only on a validated window id', async () => {
    vi.mocked(execFile).mockClear();
    vi.mocked(execFile).mockImplementation((async () => ({ stdout: '' })) as never);
    const wm = new XdotoolWindowManager();
    await wm.setFullscreen('123');
    const [file, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], unknown];
    expect([file, args[0], args[1], args.at(-1), options]).toEqual(['python3', '-I', '-c', '123', { timeout: 2000 }]);
    expect(args[2]).toContain('_NET_WM_STATE_FULLSCREEN');
    await expect(wm.setFullscreen('12; rm')).rejects.toThrow('invalid window id');
  });
});
