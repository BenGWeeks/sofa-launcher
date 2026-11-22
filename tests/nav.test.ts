import { describe, expect, it } from 'vitest';
import { realMove } from '../src/renderer/src/lib/nav';

describe('realMove', () => {
  it('is true only when the pointer itself moved (not the page under a still pointer)', () => {
    expect(realMove({ movementX: 3, movementY: 0 } as PointerEvent)).toBe(true);
    expect(realMove({ movementX: 0, movementY: -1 } as PointerEvent)).toBe(true);
    expect(realMove({ movementX: 0, movementY: 0 } as PointerEvent)).toBe(false);
  });
});
