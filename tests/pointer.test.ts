import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemotePointer } from '../src/main/pointer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(failKey?: string) {
  const keys = new Map<string, () => void>();
  let active: string | null = '42';
  const command = vi.fn(async (_args: string[]) => {});
  const pointer = new RemotePointer({
    register: (key, callback) => {
      if (key === failKey) return false;
      keys.set(key, callback);
      return true;
    },
    unregister: (key) => { keys.delete(key); },
    activeWindow: async () => active,
    command,
  });
  const press = async (key: string) => { keys.get(key)?.(); await vi.advanceTimersByTimeAsync(0); };
  return { pointer, keys, command, press, focus: (id: string | null) => { active = id; } };
}

describe('Remote pointer', () => {
  it('moves, clicks once on held OK, scrolls and releases keys on exit', async () => {
    const { pointer, keys, command, press } = setup();
    expect(pointer.start('42')).toBe(true);
    await press('Left');
    expect(command).toHaveBeenLastCalledWith(['mousemove_relative', '--', '-16', '0']);
    await press('Return');
    await press('Return');
    expect(command.mock.calls.filter(([args]) => args[0] === 'click' && args[1] === '1')).toHaveLength(1);
    await press('PageDown');
    expect(command).toHaveBeenLastCalledWith(['click', '5']);
    pointer.stop();
    expect(keys.size).toBe(0);
    expect(pointer.active).toBe(false);
  });

  it('never clicks after focus leaves the target app', async () => {
    const { pointer, keys, command, press, focus } = setup();
    pointer.start('42');
    focus('99');
    await press('Return');
    expect(command).not.toHaveBeenCalled();
    expect(keys.size).toBe(0);
  });

  it('releases grabs when focus changes without a key press', async () => {
    const { pointer, keys, focus } = setup();
    pointer.start('42');
    focus(null);
    await vi.advanceTimersByTimeAsync(250);
    expect(keys.size).toBe(0);
  });

  it('rolls back every key if a grab fails', () => {
    const { pointer, keys } = setup('Return');
    expect(pointer.start('42')).toBe(false);
    expect(keys.size).toBe(0);
    expect(pointer.active).toBe(false);
  });

  it('releases keys when xdotool fails', async () => {
    const { pointer, keys, command, press } = setup();
    command.mockRejectedValueOnce(new Error('display unavailable'));
    pointer.start('42');
    await press('Right');
    expect(keys.size).toBe(0);
  });
});
