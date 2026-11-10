import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { appKeySender, KEYS_RELEASED_HELPER, sendKeysToApp, waitForKeysReleased } from '../src/main/app-keys';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function sender() {
  const released = deferred();
  const waitReleased = vi.fn(() => released.promise);
  const activeWindow = vi.fn(async (): Promise<string | null> => '7');
  const xdotool = vi.fn(async () => {});
  return { released, waitReleased, activeWindow, xdotool, send: appKeySender({ waitReleased, activeWindow, xdotool }) };
}

// Exercise the production subprocess wiring as well as the injected sender.
function mockProcesses(helper: (callback: (error: Error | null) => void) => void) {
  vi.mocked(execFile).mockImplementation(((file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string) => void) => {
    if (file === 'python3') helper(callback);
    else callback(null, args[0] === 'getactivewindow' ? '7\n' : '');
  }) as typeof execFile);
}

describe('app keys', () => {
  it('sends nothing until the held keys are released', async () => {
    const s = sender();
    const pending = s.send('alt+Left');
    await vi.waitFor(() => expect(s.waitReleased).toHaveBeenCalledOnce());
    expect(s.xdotool).not.toHaveBeenCalled();
    s.released.resolve();
    expect(await pending).toBe(true);
    expect(s.xdotool).toHaveBeenCalledExactlyOnceWith(['key', '--clearmodifiers', 'alt+Left']);
  });

  it.each([600, 1000, 1500])('ignores auto-repeat after %i ms while waiting for release', async delay => {
    vi.useFakeTimers();
    const s = sender();
    const pending = s.send('Escape');
    await vi.advanceTimersByTimeAsync(delay);
    expect(await s.send('Escape')).toBe(false);
    expect(s.waitReleased).toHaveBeenCalledOnce();
    s.released.resolve();
    await pending;
    expect(s.xdotool).toHaveBeenCalledOnce();
    await s.send('Escape');
    expect(s.xdotool).toHaveBeenCalledTimes(2);
  });

  it('ignores repeats during sending while allowing different actions', async () => {
    const s = sender();
    const sending = deferred();
    s.xdotool.mockImplementationOnce(() => sending.promise);
    s.released.resolve();
    const pending = s.send('Escape');
    await vi.waitFor(() => expect(s.xdotool).toHaveBeenCalledOnce());
    await s.send('Escape');
    await s.send('ctrl+shift+F8');
    expect(s.xdotool.mock.calls).toEqual([
      [['key', '--clearmodifiers', 'Escape']],
      [['key', '--clearmodifiers', 'ctrl+shift+F8']],
    ]);
    sending.resolve();
    await pending;
  });

  it.each(['8', null])('cancels after focus changes to %s during the release wait', async windowId => {
    const s = sender();
    const pending = s.send('Escape');
    await vi.waitFor(() => expect(s.waitReleased).toHaveBeenCalledOnce());
    s.activeWindow.mockResolvedValue(windowId);
    s.released.resolve();
    expect(await pending).toBe(false);
    expect(s.xdotool).not.toHaveBeenCalled();
    // Cancellation must also release the guard.
    s.activeWindow.mockResolvedValue('7');
    await s.send('Escape');
    expect(s.xdotool).toHaveBeenCalledOnce();
  });

  it('does not forward when the original active window cannot be read', async () => {
    const s = sender();
    s.activeWindow.mockResolvedValue(null);
    expect(await s.send('Escape')).toBe(false);
    expect(s.waitReleased).not.toHaveBeenCalled();
    expect(s.xdotool).not.toHaveBeenCalled();
  });

  it.each(['wait', 'send', 'focus'])('clears the guard after a %s failure', async stage => {
    const s = sender();
    s.released.resolve();
    const error = new Error('unavailable');
    if (stage === 'wait') s.waitReleased.mockRejectedValueOnce(error);
    if (stage === 'send') s.xdotool.mockRejectedValueOnce(error);
    if (stage === 'focus') s.activeWindow.mockRejectedValueOnce(error);
    await expect(s.send('Escape')).rejects.toThrow(error);
    await s.send('Escape');
    expect(s.xdotool).toHaveBeenLastCalledWith(['key', '--clearmodifiers', 'Escape']);
  });

  it.each([null, new Error('helper timed out'), new Error('python unavailable')])('still sends after helper completion: %s', async error => {
    let complete!: (error: Error | null) => void;
    mockProcesses(callback => { complete = callback; });
    const pending = sendKeysToApp('ctrl+shift+F8');
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledWith('python3', ['-I', '-c', KEYS_RELEASED_HELPER, '1500'], { timeout: 2500 }, expect.any(Function)));
    complete(error);
    await pending;
    expect(execFile).toHaveBeenLastCalledWith('xdotool', ['key', '--clearmodifiers', 'ctrl+shift+F8'], { timeout: 2000 }, expect.any(Function));
  });

  it('bounds the wait and rechecks focus before sending after the release timeout', async () => {
    vi.useFakeTimers();
    mockProcesses(callback => { setTimeout(() => callback(null), 1500); });
    const pending = sendKeysToApp('Escape');
    await vi.advanceTimersByTimeAsync(1499);
    expect(execFile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(vi.mocked(execFile).mock.calls.map(call => call[1])).toEqual([
      ['getactivewindow'], ['-I', '-c', KEYS_RELEASED_HELPER, '1500'],
      ['getactivewindow'], ['key', '--clearmodifiers', 'Escape'],
    ]);
  });

  it('passes a custom bounded timeout to the isolated helper', async () => {
    mockProcesses(callback => callback(null));
    await waitForKeysReleased(200);
    expect(execFile).toHaveBeenCalledWith('python3', ['-I', '-c', KEYS_RELEASED_HELPER, '200'], { timeout: 1200 }, expect.any(Function));
  });
});
