/** Pure focus-movement logic for a grid of `count` tiles, `cols` per row. */
export function moveFocus(index: number, key: string, count: number, cols: number): number {
  if (count === 0) return 0;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return index - cols >= 0 ? index - cols : index;
    case 'ArrowDown':
      return Math.min(count - 1, index + cols);
    default:
      return index;
  }
}

/** Focus on the home screen's single-line rows (Apps, Games, Cameras) or, with `footer` set, the footer buttons. */
export interface RowFocus {
  row: number;
  index: number;
  footer: number | null;
}

/**
 * Left/Right move within a row; Up/Down move to the nearest non-empty row, keeping the same
 * position where that row has it. Down from the last row enters the footer; Up from the
 * footer returns to the tile it was entered from.
 */
export function moveRowFocus(f: RowFocus, key: string, lengths: number[], footerCount: number): RowFocus {
  if (f.footer !== null) {
    if (key === 'ArrowLeft') return { ...f, footer: Math.max(0, f.footer - 1) };
    if (key === 'ArrowRight') return { ...f, footer: Math.min(footerCount - 1, f.footer + 1) };
    if (key === 'ArrowUp') return { ...f, footer: null };
    return f;
  }
  const length = lengths[f.row] ?? 0;
  const into = (row: number): RowFocus => ({ row, index: Math.min(f.index, lengths[row]! - 1), footer: null });
  switch (key) {
    case 'ArrowLeft':
      return { ...f, index: Math.max(0, f.index - 1) };
    case 'ArrowRight':
      return { ...f, index: Math.max(0, Math.min(length - 1, f.index + 1)) };
    case 'ArrowDown': {
      for (let row = f.row + 1; row < lengths.length; row++) if (lengths[row]! > 0) return into(row);
      return footerCount > 0 ? { ...f, footer: Math.min(f.index, footerCount - 1) } : f;
    }
    case 'ArrowUp': {
      for (let row = f.row - 1; row >= 0; row--) if (lengths[row]! > 0) return into(row);
      return f;
    }
    default:
      return f;
  }
}

/** Focus in a list of headed grids (Edit home screen): which section, which tile in it. */
export interface SectionFocus {
  section: number;
  index: number;
}

/** The first tile of the first non-empty section (or 0/0 if every section is empty). */
export function firstSectionFocus(lengths: number[]): SectionFocus {
  const section = lengths.findIndex((n) => n > 0);
  return { section: Math.max(0, section), index: 0 };
}

/**
 * Two-dimensional movement across headed grids of different lengths. `cols` is the tiles per
 * row: one number for all sections, or one per section (a one-line row: its length).
 * Left/Right move within a section and stop at its ends. Up/Down move a row; past a section's
 * edge they enter the nearest non-empty section, in the same column where it has one (else its
 * nearest tile). Where nothing is reachable, focus stays put.
 */
export function moveSectionFocus(f: SectionFocus, key: string, lengths: number[], cols: number | number[]): SectionFocus {
  const colsOf = (s: number) => Math.max(1, Array.isArray(cols) ? cols[s] ?? 1 : cols);
  const length = lengths[f.section] ?? 0;
  if (length === 0) {
    const first = firstSectionFocus(lengths);
    return lengths[first.section] ? first : f;
  }
  const c = colsOf(f.section);
  const column = f.index % c;
  switch (key) {
    case 'ArrowLeft':
      return { ...f, index: Math.max(0, f.index - 1) };
    case 'ArrowRight':
      return { ...f, index: Math.min(length - 1, f.index + 1) };
    case 'ArrowUp': {
      if (f.index - c >= 0) return { ...f, index: f.index - c };
      for (let s = f.section - 1; s >= 0; s--) {
        const n = lengths[s] ?? 0;
        if (n === 0) continue;
        const sc = colsOf(s);
        const lastRow = Math.floor((n - 1) / sc) * sc;
        return { section: s, index: Math.min(n - 1, lastRow + Math.min(column, sc - 1)) };
      }
      return f;
    }
    case 'ArrowDown': {
      const lastRow = Math.floor((length - 1) / c);
      if (Math.floor(f.index / c) < lastRow) return { ...f, index: Math.min(length - 1, f.index + c) };
      for (let s = f.section + 1; s < lengths.length; s++) {
        const n = lengths[s] ?? 0;
        if (n > 0) return { section: s, index: Math.min(n - 1, Math.min(column, colsOf(s) - 1)) };
      }
      return f;
    }
    default:
      return f;
  }
}

/**
 * The home screen with games but no cameras: the Apps grid (wrapped, `cols` per row) above the
 * one-line Games row, then the footer. Down from the Games row enters the footer; Up from the
 * footer returns to the tile it came from.
 */
export function moveWrappedFocus(f: RowFocus, key: string, lengths: [number, number], cols: number, footerCount: number): RowFocus {
  if (f.footer !== null) return moveRowFocus(f, key, lengths, footerCount);
  const sectionCols = [cols, Math.max(1, lengths[1])];
  const next = moveSectionFocus({ section: f.row, index: f.index }, key, lengths, sectionCols);
  if (key === 'ArrowDown' && next.section === f.row && next.index === f.index && footerCount > 0) {
    return { ...f, footer: Math.min(f.index % sectionCols[f.row]!, footerCount - 1) };
  }
  return { row: next.section, index: next.index, footer: null };
}

/** Keys that mean "Back" from a remote (Flirc AC Back) or a keyboard. */
export const BACK_KEYS = new Set(['BrowserBack', 'Escape', 'Backspace', 'GoBack']);

/** Focus inside the slide-up panel: a row of tiles above a row of actions. */
export interface PanelFocus {
  row: 0 | 1;
  index: number;
}

export function movePanelFocus(f: PanelFocus, key: string, tiles: number, actions: number): PanelFocus {
  const count = f.row === 0 ? tiles : actions;
  switch (key) {
    case 'ArrowLeft':
      return { ...f, index: Math.max(0, f.index - 1) };
    case 'ArrowRight':
      return { ...f, index: Math.min(Math.max(0, count - 1), f.index + 1) };
    case 'ArrowDown':
      return f.row === 0 && actions > 0 ? { row: 1, index: Math.min(f.index, actions - 1) } : f;
    case 'ArrowUp':
      return f.row === 1 && tiles > 0 ? { row: 0, index: Math.min(f.index, tiles - 1) } : f;
    default:
      return f;
  }
}
