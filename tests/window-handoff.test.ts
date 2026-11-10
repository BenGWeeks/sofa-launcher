import { describe, expect, it, vi } from 'vitest';
import { WindowHandoff, waitForWindowPaint } from '../src/main/window-handoff';

describe('fullscreen window handoff', () => {
  it('keeps the outgoing cover until the replacement has acknowledged focus', async () => {
    const handoff = new WindowHandoff(); const hide = vi.fn();
    let focused!: () => void;
    const pending = handoff.run(() => new Promise<void>(resolve => { focused = resolve; }), hide);
    expect(handoff.active).toBe(true); expect(hide).not.toHaveBeenCalled();
    focused(); await pending;
    expect(hide).toHaveBeenCalledOnce(); expect(handoff.active).toBe(false);
  });
  it('leaves the cover visible if activation fails and releases the blur guard', async () => {
    const handoff = new WindowHandoff(); const hide = vi.fn();
    await expect(handoff.run(async () => { throw new Error('Window closed'); }, hide)).rejects.toThrow('Window closed');
    expect(hide).not.toHaveBeenCalled(); expect(handoff.active).toBe(false);
  });
  it('does not let an old dismissal hide a newly opened panel', async () => {
    const handoff = new WindowHandoff(); const hide = vi.fn();
    let focused!: () => void;
    const pending = handoff.run(() => new Promise<void>(resolve => { focused = resolve; }), hide);
    handoff.cancel(); focused(); await pending;
    expect(hide).not.toHaveBeenCalled(); expect(handoff.active).toBe(false);
  });
  it('keeps the blur guard until overlapping transitions finish, while only the newest may hide', async () => {
    const handoff = new WindowHandoff(); const firstHide = vi.fn(); const secondHide = vi.fn();
    let first!: () => void;
    const pending = handoff.run(() => new Promise<void>(resolve => { first = resolve; }), firstHide);
    await handoff.run(async () => undefined, () => { expect(handoff.active).toBe(true); secondHide(); });
    expect(handoff.active).toBe(true); expect(secondHide).toHaveBeenCalledOnce();
    first(); await pending;
    expect(firstHide).not.toHaveBeenCalled(); expect(handoff.active).toBe(false);
  });
});

describe('paint-ready overlay handoff', () => {
  it('does not focus until the supplied renderer paint has completed', async () => {
    let painted!: () => void; const focus = vi.fn();
    const pending = waitForWindowPaint(() => new Promise(resolve => { painted = () => resolve(true); })).then(focus);
    expect(focus).not.toHaveBeenCalled(); painted(); await pending; expect(focus).toHaveBeenCalledOnce();
  });
  it('bounds a hidden or unresponsive renderer wait', async () => {
    vi.useFakeTimers();
    const pending = expect(waitForWindowPaint(() => new Promise(() => undefined))).rejects.toThrow('did not paint');
    await vi.advanceTimersByTimeAsync(1000); await pending; vi.useRealTimers();
  });
});
