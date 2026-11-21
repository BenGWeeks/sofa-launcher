import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeReveal } from '../src/main/edge-reveal';

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };
const MIDDLE = { x: 960, y: 500 };
const EDGE = { x: 960, y: 1079 };

function fixture(screen = SCREEN) {
  const state = { cursor: MIDDLE, enabled: true };
  const reveal = vi.fn();
  const edge = new EdgeReveal({ cursor: () => state.cursor, screen: () => screen, enabled: () => state.enabled, reveal });
  const samples = (cursor: { x: number; y: number }, count = 1) => {
    state.cursor = cursor;
    for (let i = 0; i < count; i++) edge.sample();
  };
  return { state, reveal, edge, samples };
}

describe('EdgeReveal', () => {
  afterEach(() => vi.useRealTimers());

  it('opens the panel once the pointer has rested on the bottom edge', () => {
    const f = fixture();
    f.samples(MIDDLE);
    f.samples(EDGE, 2);
    expect(f.reveal).not.toHaveBeenCalled();
    f.samples(EDGE);
    expect(f.reveal).toHaveBeenCalledOnce();
  });

  it('ignores a pointer that only brushes the edge', () => {
    const f = fixture();
    f.samples(MIDDLE);
    f.samples(EDGE, 2);
    f.samples(MIDDLE);
    f.samples(EDGE, 2);
    expect(f.reveal).not.toHaveBeenCalled();
  });

  it('opens once per visit: the pointer must leave the edge and come back', () => {
    const f = fixture();
    f.samples(MIDDLE);
    f.samples(EDGE, 20);
    expect(f.reveal).toHaveBeenCalledOnce();
    f.samples(MIDDLE);
    f.samples(EDGE, 3);
    expect(f.reveal).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a pointer already resting on the edge at start-up', () => {
    const f = fixture();
    f.samples(EDGE, 20);
    expect(f.reveal).not.toHaveBeenCalled();
  });

  it('does not open when the pointer was parked on the edge before it became enabled', () => {
    const f = fixture();
    f.state.enabled = false;
    f.samples(MIDDLE);
    f.samples(EDGE, 5);
    f.state.enabled = true; // an app came to the front under a parked pointer
    f.samples(EDGE, 20);
    expect(f.reveal).not.toHaveBeenCalled();
    f.samples(MIDDLE);
    f.samples(EDGE, 3);
    expect(f.reveal).toHaveBeenCalledOnce();
  });

  it('counts only the bottom rows of the given screen', () => {
    const f = fixture({ x: 1920, y: 0, width: 1280, height: 720 });
    f.samples(MIDDLE);
    f.samples({ x: 960, y: 719 }, 5); // right height, but on the screen to the left
    f.samples({ x: 2500, y: 717 }, 5); // right screen, just above the edge
    expect(f.reveal).not.toHaveBeenCalled();
    f.samples({ x: 2500, y: 718 }, 3);
    expect(f.reveal).toHaveBeenCalledOnce();
  });

  it('treats an unreadable pointer as away from the edge', () => {
    const reveal = vi.fn();
    const edge = new EdgeReveal({ cursor: () => { throw new Error('no display'); }, screen: () => SCREEN, enabled: () => true, reveal });
    expect(() => { for (let i = 0; i < 5; i++) edge.sample(); }).not.toThrow();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('samples on a timer between start and stop', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.edge.start(); f.edge.start();
    vi.advanceTimersByTime(100); // one sample in the middle arms it
    f.state.cursor = EDGE;
    vi.advanceTimersByTime(300);
    expect(f.reveal).toHaveBeenCalledOnce();
    f.edge.stop();
    f.state.cursor = MIDDLE;
    vi.advanceTimersByTime(1000);
    f.state.cursor = EDGE;
    vi.advanceTimersByTime(1000);
    expect(f.reveal).toHaveBeenCalledOnce();
  });
});
