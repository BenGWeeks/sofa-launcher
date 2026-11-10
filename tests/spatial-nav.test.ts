import { describe, expect, it } from 'vitest';
import { spatialMove, type Box } from '../src/renderer/src/lib/spatial-nav';

/** Cards 10 wide, 5 high; rows 8 apart. Row 0: a stack of 3 then one of 2; row 1: 5; row 2: 1. */
const card = (col: number, row: number, shift = 0): Box => ({ x: col * 12 + shift, y: row * 8, width: 10, height: 5 });
const boxes: Box[] = [
  card(0, 0), card(1, 0), card(2, 0), card(3, 0, 2), card(4, 0, 2),
  card(0, 1), card(1, 1), card(2, 1), card(3, 1), card(4, 1),
  card(0, 2),
];

describe('containers grid navigation', () => {
  it('moves left and right in reading order, across stacks and rows', () => {
    expect(spatialMove(boxes, 2, 'ArrowRight')).toBe(3);
    expect(spatialMove(boxes, 4, 'ArrowRight')).toBe(5);
    expect(spatialMove(boxes, 5, 'ArrowLeft')).toBe(4);
    expect(spatialMove(boxes, 0, 'ArrowLeft')).toBe(0);
    expect(spatialMove(boxes, 10, 'ArrowRight')).toBe(10);
  });

  it('moves up and down to the nearest card in the next row', () => {
    expect(spatialMove(boxes, 3, 'ArrowDown')).toBe(8);
    expect(spatialMove(boxes, 8, 'ArrowUp')).toBe(3);
    expect(spatialMove(boxes, 9, 'ArrowDown')).toBe(10); // a shorter row: the nearest card in it
    expect(spatialMove(boxes, 10, 'ArrowUp')).toBe(5);
  });

  it('stays put at the edges', () => {
    expect(spatialMove(boxes, 1, 'ArrowUp')).toBe(1);
    expect(spatialMove(boxes, 10, 'ArrowDown')).toBe(10);
  });

  it('copes with no cards and other keys', () => {
    expect(spatialMove([], 0, 'ArrowDown')).toBe(0);
    expect(spatialMove(boxes, 99, 'ArrowDown')).toBe(0);
    expect(spatialMove(boxes, 2, 'Enter')).toBe(2);
  });

  it('skips a stack heading between rows (larger vertical gap)', () => {
    const withHeading = [card(0, 0), card(1, 0), { ...card(0, 2), y: 20 }, { ...card(1, 2), y: 20 }];
    expect(spatialMove(withHeading, 1, 'ArrowDown')).toBe(3);
  });
});
