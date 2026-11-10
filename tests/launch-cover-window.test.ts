import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  destroy: vi.fn(),
  setIgnoreMouseEvents: vi.fn(),
  loadURL: vi.fn(),
  getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0]),
}));
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function () { return fake; }),
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
}));

import { BrowserWindow } from 'electron';
import { prepareLaunchCover } from '../src/main/launch-cover-window';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('optional launch cover window', () => {
  it('uses a black background without loading a renderer document', async () => {
    const setType = vi.fn(async () => undefined);
    const lockDown = vi.fn();
    expect(await prepareLaunchCover({ setType }, lockDown)).toBe(fake);
    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false, backgroundColor: '#000000', width: 1920, height: 1080,
    }));
    expect(lockDown).toHaveBeenCalledWith(fake);
    expect(setType).toHaveBeenCalledWith('42', 'notification');
    expect(fake.loadURL).not.toHaveBeenCalled();
  });

  it.each(['xprop failed', 'xprop timed out'])('discards the cover and allows startup to continue when %s', async message => {
    const error = new Error(message);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const setType = vi.fn(async () => { throw error; });
    const window = await prepareLaunchCover({ setType }, vi.fn());
    expect(window).toBeNull();
    expect(fake.destroy).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('continuing with Home'), error);
  });
});
