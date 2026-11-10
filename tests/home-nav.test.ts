import { describe, expect, it } from 'vitest';
import { firstSectionFocus, moveRowFocus, moveSectionFocus, moveWrappedFocus, type RowFocus, type SectionFocus } from '../src/renderer/src/lib/nav';

const at = (row: number, index: number, footer: number | null = null): RowFocus => ({ row, index, footer });

describe('home row focus (Apps, Games, Cameras, footer)', () => {
  const lengths = [10, 8, 10];
  it('moves within a row, stopping at its ends', () => {
    expect(moveRowFocus(at(1, 0), 'ArrowLeft', lengths, 5)).toEqual(at(1, 0));
    expect(moveRowFocus(at(1, 6), 'ArrowRight', lengths, 5)).toEqual(at(1, 7));
    expect(moveRowFocus(at(1, 7), 'ArrowRight', lengths, 5)).toEqual(at(1, 7));
  });
  it('moves between rows keeping the position where the row has it', () => {
    expect(moveRowFocus(at(0, 3), 'ArrowDown', lengths, 5)).toEqual(at(1, 3));
    expect(moveRowFocus(at(0, 9), 'ArrowDown', lengths, 5)).toEqual(at(1, 7));
    expect(moveRowFocus(at(2, 9), 'ArrowUp', lengths, 5)).toEqual(at(1, 7));
    expect(moveRowFocus(at(0, 2), 'ArrowUp', lengths, 5)).toEqual(at(0, 2));
  });
  it('skips empty rows', () => {
    expect(moveRowFocus(at(0, 2), 'ArrowDown', [4, 0, 3], 5)).toEqual(at(2, 2));
    expect(moveRowFocus(at(2, 2), 'ArrowUp', [4, 0, 3], 5)).toEqual(at(0, 2));
  });
  it('enters the footer from the last row and returns to the same tile', () => {
    const footer = moveRowFocus(at(2, 9), 'ArrowDown', lengths, 5);
    expect(footer).toEqual(at(2, 9, 4));
    expect(moveRowFocus(footer, 'ArrowLeft', lengths, 5)).toEqual(at(2, 9, 3));
    expect(moveRowFocus(at(2, 9, 4), 'ArrowRight', lengths, 5)).toEqual(at(2, 9, 4));
    expect(moveRowFocus(footer, 'ArrowDown', lengths, 5)).toEqual(footer);
    expect(moveRowFocus(footer, 'ArrowUp', lengths, 5)).toEqual(at(2, 9));
    expect(moveRowFocus(at(2, 1), 'ArrowDown', lengths, 5)).toEqual(at(2, 1, 1));
  });
});

const sec = (section: number, index: number): SectionFocus => ({ section, index });

describe('Edit home screen focus (headed grids of different lengths)', () => {
  // Apps 14 (rows of 10: 10 + 4), Games 3, Cameras 25 (10 + 10 + 5).
  const lengths = [14, 3, 25];
  const move = (f: SectionFocus, ...keys: string[]) => keys.reduce((at, key) => moveSectionFocus(at, key, lengths, 10), f);
  it('moves within a grid and stops at its ends', () => {
    expect(move(sec(0, 0), 'ArrowLeft')).toEqual(sec(0, 0));
    expect(move(sec(0, 9), 'ArrowRight')).toEqual(sec(0, 10));
    expect(move(sec(0, 13), 'ArrowRight')).toEqual(sec(0, 13));
    expect(move(sec(0, 2), 'ArrowDown')).toEqual(sec(0, 12));
    expect(move(sec(0, 7), 'ArrowDown')).toEqual(sec(0, 13)); // the shorter last row: its nearest tile
    expect(move(sec(0, 12), 'ArrowUp')).toEqual(sec(0, 2));
  });
  it('moves between sections in the same column, or the nearest tile', () => {
    expect(move(sec(0, 12), 'ArrowDown')).toEqual(sec(1, 2));
    expect(move(sec(0, 13), 'ArrowDown')).toEqual(sec(1, 2));
    expect(move(sec(1, 1), 'ArrowDown')).toEqual(sec(2, 1));
    expect(move(sec(2, 3), 'ArrowUp')).toEqual(sec(1, 2));
    expect(move(sec(1, 0), 'ArrowUp')).toEqual(sec(0, 10));
    expect(move(sec(1, 2), 'ArrowUp')).toEqual(sec(0, 12));
    expect(move(sec(2, 24), 'ArrowDown')).toEqual(sec(2, 24));
    expect(move(sec(0, 4), 'ArrowUp')).toEqual(sec(0, 4));
  });
  it('reaches the last camera and comes back', () => {
    const last = move(sec(0, 0), 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight');
    expect(last).toEqual(sec(2, 24));
    expect(move(last, 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp')).toEqual(sec(0, 2));
  });
  it('skips empty sections and starts on the first tile there is', () => {
    expect(moveSectionFocus(sec(0, 3), 'ArrowDown', [4, 0, 2], 10)).toEqual(sec(2, 1));
    expect(moveSectionFocus(sec(2, 0), 'ArrowUp', [4, 0, 2], 10)).toEqual(sec(0, 0));
    expect(firstSectionFocus([0, 0, 3])).toEqual(sec(2, 0));
    expect(firstSectionFocus([0, 0, 0])).toEqual(sec(0, 0));
    expect(moveSectionFocus(sec(0, 0), 'ArrowRight', [0, 0, 3], 10)).toEqual(sec(2, 0));
    expect(moveSectionFocus(sec(0, 0), 'ArrowDown', [0, 0, 0], 10)).toEqual(sec(0, 0));
  });
});

describe('home with games but no cameras (wrapped Apps grid, Games row, footer)', () => {
  const lengths: [number, number] = [10, 8];
  const move = (f: RowFocus, ...keys: string[]) => keys.reduce((at, key) => moveWrappedFocus(at, key, lengths, 6, 5), f);
  it('Down goes through the Apps grid, into Games, then the footer', () => {
    expect(move(at(0, 2), 'ArrowDown')).toEqual(at(0, 8));
    expect(move(at(0, 5), 'ArrowDown')).toEqual(at(0, 9));
    expect(move(at(0, 8), 'ArrowDown')).toEqual(at(1, 2));
    expect(move(at(1, 7), 'ArrowDown')).toEqual(at(1, 7, 4));
    expect(move(at(1, 1), 'ArrowDown')).toEqual(at(1, 1, 1));
  });
  it('Up returns from the footer to its tile, then from Games to the Apps grid', () => {
    expect(move(at(1, 7, 4), 'ArrowUp')).toEqual(at(1, 7));
    expect(move(at(1, 7), 'ArrowUp')).toEqual(at(0, 9));
    expect(move(at(1, 2), 'ArrowUp')).toEqual(at(0, 8));
    expect(move(at(0, 8), 'ArrowUp')).toEqual(at(0, 2));
    expect(move(at(0, 2), 'ArrowUp')).toEqual(at(0, 2));
  });
  it('Left and Right stay in their row; the Games row runs its whole length', () => {
    expect(move(at(1, 0), 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight')).toEqual(at(1, 7));
    expect(move(at(1, 0), 'ArrowLeft')).toEqual(at(1, 0));
    expect(move(at(0, 9), 'ArrowRight')).toEqual(at(0, 9));
    expect(move(at(1, 3, 2), 'ArrowLeft', 'ArrowLeft', 'ArrowLeft')).toEqual(at(1, 3, 0));
  });
  it('with a single row of apps, Down from it reaches Games directly', () => {
    expect(moveWrappedFocus(at(0, 4), 'ArrowDown', [5, 3], 6, 5)).toEqual(at(1, 2));
  });
});
