export type KeyboardPage = 'letters' | 'symbols';

export function keyboardRows(page: KeyboardPage, shift: boolean): string[][] {
  const bottom = [page === 'letters' ? '#+=' : 'ABC', 'Space', 'Mic', 'Type text', 'Cancel'];
  if (page === 'symbols') return [
    [...'1234567890'], [...'[]{}#%^*+=()'], [...'_\\|~<>€£¥•@'], [...'-/:;!?$".,\'', 'Delete'], bottom,
  ];
  const letters = (row: string) => [...(shift ? row.toUpperCase() : row)];
  return [[...'1234567890'], letters('qwertyuiop'), letters('asdfghjkl'), ['Shift', ...letters('zxcvbnm'), 'Delete'], bottom];
}

/** Move between rows of different widths using the nearest relative position. */
export function moveKeyboardFocus(rows: string[][], focus: number, key: string): number {
  let row = 0, offset = 0;
  while (row < rows.length - 1 && focus >= offset + rows[row]!.length) offset += rows[row++]!.length;
  const column = focus - offset, length = rows[row]!.length;
  if (key === 'ArrowLeft') return Math.max(offset, focus - 1);
  if (key === 'ArrowRight') return Math.min(offset + length - 1, focus + 1);
  const target = key === 'ArrowUp' ? row - 1 : key === 'ArrowDown' ? row + 1 : row;
  if (target < 0 || target >= rows.length || target === row) return focus;
  const targetLength = rows[target]!.length;
  const next = Math.round(column / Math.max(1, length - 1) * (targetLength - 1));
  return rows.slice(0, target).reduce((sum, current) => sum + current.length, 0) + next;
}
