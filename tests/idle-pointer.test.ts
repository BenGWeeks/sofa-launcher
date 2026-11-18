import { describe, expect, it, vi } from 'vitest';
import { IdlePointer, IDLE_POINTER_HELPER, type IdlePointerChild } from '../src/main/idle-pointer';

function fixture() {
  const listeners = new Map<string, () => void>();
  const child = { stdin: { end: vi.fn() }, kill: vi.fn(() => true), once: vi.fn((event: string, cb: () => void) => listeners.set(event, cb)) };
  const spawner = vi.fn((_file: string, _args: string[]) => child as IdlePointerChild);
  return { child, spawner, listeners };
}

describe('IdlePointer', () => {
  it('starts one isolated helper with the idle time, however often it is asked', () => {
    const f = fixture();
    const pointer = new IdlePointer(3, f.spawner);
    pointer.start(); pointer.start();
    expect(f.spawner).toHaveBeenCalledExactlyOnceWith('python3', ['-I', '-c', IDLE_POINTER_HELPER, '3']);
    expect(pointer.running).toBe(true);
  });

  it('closes the helper stdin and stops it, so the pointer comes back', () => {
    const f = fixture();
    const pointer = new IdlePointer(3, f.spawner);
    pointer.start(); pointer.stop(); pointer.stop();
    expect(f.child.stdin.end).toHaveBeenCalledOnce();
    expect(f.child.kill).toHaveBeenCalledOnce();
    expect(pointer.running).toBe(false);
  });

  it.each(['exit', 'error'])('can start again after the helper reports %s', (event) => {
    const f = fixture();
    const pointer = new IdlePointer(3, f.spawner);
    pointer.start();
    f.listeners.get(event)!();
    expect(pointer.running).toBe(false);
    pointer.start();
    expect(f.spawner).toHaveBeenCalledTimes(2);
  });

  it('leaves the pointer visible when the helper cannot be started', () => {
    const pointer = new IdlePointer(3, () => { throw new Error('no python3'); });
    expect(() => pointer.start()).not.toThrow();
    expect(pointer.running).toBe(false);
  });

  it('shows the pointer on movement and exits when the launcher goes away', () => {
    expect(IDLE_POINTER_HELPER).toContain('XFixesHideCursor');
    expect(IDLE_POINTER_HELPER).toContain('XFixesShowCursor');
    expect(IDLE_POINTER_HELPER).toContain('not os.read(0, 64): break');
  });
});
