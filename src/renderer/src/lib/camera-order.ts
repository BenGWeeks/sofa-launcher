/** The camera grid's tile: always first in the Cameras row. */
export const ALL_CAMERAS_ID = 'all-cameras';

/**
 * The Cameras row's order: All cameras first, then cameras with a current still (the ones that
 * are working), then the rest. Within each group the configured order is kept.
 */
export function orderCameras<T extends { id: string }>(cameras: readonly T[], hasStill: (id: string) => boolean): T[] {
  const all = cameras.filter((c) => c.id === ALL_CAMERAS_ID);
  const rest = cameras.filter((c) => c.id !== ALL_CAMERAS_ID);
  return [...all, ...rest.filter((c) => hasStill(c.id)), ...rest.filter((c) => !hasStill(c.id))];
}

/**
 * The same tiles in an order shown before (while the user moves along the row, so the focused
 * tile never jumps): tiles keep their places, removed ones drop out, new ones join at the end.
 */
export function keepOrder<T extends { id: string }>(cameras: readonly T[], previous: readonly string[]): T[] {
  const place = new Map(previous.map((id, i) => [id, i]));
  const known = cameras.filter((c) => place.has(c.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  return [...known, ...cameras.filter((c) => !place.has(c.id))];
}
