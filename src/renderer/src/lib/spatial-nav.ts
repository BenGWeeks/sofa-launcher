/** A card's position on screen (getBoundingClientRect, or test data). */
export interface Box { x: number; y: number; width: number; height: number }

/**
 * Remote focus over cards laid out in packed groups (rows of different lengths).
 * Left/Right follow reading order. Up/Down go to the nearest row above/below and, in it,
 * the card whose centre is closest horizontally. At an edge the focus stays put.
 */
export function spatialMove(boxes: Box[], index: number, key: string): number {
  const current = boxes[index];
  if (!current) return boxes.length ? 0 : index;
  if (key === 'ArrowLeft') return Math.max(0, index - 1);
  if (key === 'ArrowRight') return Math.min(boxes.length - 1, index + 1);
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return index;
  const up = key === 'ArrowUp';
  const centre = (b: Box) => b.x + b.width / 2;
  const candidates = boxes
    .map((box, i) => ({ box, i }))
    .filter(({ box }) => up ? box.y + box.height <= current.y + 1 : box.y >= current.y + current.height - 1);
  if (!candidates.length) return index;
  // The nearest row: the smallest vertical distance, allowing half a card of slack.
  const distance = (b: Box) => up ? current.y - b.y : b.y - current.y;
  const nearest = Math.min(...candidates.map(({ box }) => distance(box)));
  const row = candidates.filter(({ box }) => distance(box) <= nearest + current.height / 2);
  row.sort((a, b) => Math.abs(centre(a.box) - centre(current)) - Math.abs(centre(b.box) - centre(current)) || a.i - b.i);
  return row[0]!.i;
}
