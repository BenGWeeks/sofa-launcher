import { describe, it, expect } from 'vitest';
import { keyboardRows, moveKeyboardFocus } from '../src/renderer/src/lib/keyboard-layout';

describe('Remote keyboard pages', () => {
  it('keeps numbers above both letters and symbols, with persistent actions', () => {
    expect(keyboardRows('letters', false)[0]?.join('')).toBe('1234567890');
    expect(keyboardRows('letters', false)[1]?.join('')).toBe('qwertyuiop');
    expect(keyboardRows('letters', true)[1]?.join('')).toBe('QWERTYUIOP');
    expect(keyboardRows('symbols', false)[0]?.join('')).toBe('1234567890');
    expect(keyboardRows('symbols', false).flat()).toContain('£');
    for (const symbol of ['.', ',', '@', "'", '(', ')']) expect(keyboardRows('symbols', false).flat()).toContain(symbol);
    for (const page of ['letters', 'symbols'] as const) {
      expect(keyboardRows(page, false).at(-1)).toEqual([page === 'letters' ? '#+=' : 'ABC', 'Space', 'Mic', 'Type text', 'Cancel']);
    }
  });
  it('aligns vertical movement across different row lengths and keeps horizontal movement within a row', () => {
    const rows = keyboardRows('letters', false);
    expect(moveKeyboardFocus(rows, 19, 'ArrowDown')).toBe(28);
    expect(moveKeyboardFocus(rows, 28, 'ArrowRight')).toBe(28);
    expect(moveKeyboardFocus(rows, 29, 'ArrowLeft')).toBe(29);
    expect(moveKeyboardFocus(rows, 37, 'ArrowDown')).toBe(42);
    expect(moveKeyboardFocus(rows, 0, 'ArrowUp')).toBe(0);
  });
});
