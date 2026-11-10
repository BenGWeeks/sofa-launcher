import { describe, expect, it } from 'vitest';
import { keepOrder, orderCameras } from '../src/renderer/src/lib/camera-order';

const tiles = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe('Cameras row order', () => {
  const row = tiles('all-cameras', 'camera-front', 'camera-barn', 'camera-garden', 'camera-hall', 'camera-gate');

  it('puts All cameras first, then cameras with a still, keeping config order within each group', () => {
    const stills = new Set(['camera-garden', 'camera-front', 'camera-gate']);
    expect(ids(orderCameras(row, (id) => stills.has(id)))).toEqual(['all-cameras', 'camera-front', 'camera-garden', 'camera-gate', 'camera-barn', 'camera-hall']);
  });

  it('keeps config order when no camera (or every camera) has a still', () => {
    expect(ids(orderCameras(row, () => false))).toEqual(ids(row));
    expect(ids(orderCameras(row, (id) => id !== 'all-cameras'))).toEqual(ids(row));
  });

  it('works without an All cameras tile, and never moves All cameras even if it had a still', () => {
    expect(ids(orderCameras(tiles('camera-a', 'camera-b'), (id) => id === 'camera-b'))).toEqual(['camera-b', 'camera-a']);
    expect(ids(orderCameras(tiles('camera-a', 'all-cameras'), () => false))).toEqual(['all-cameras', 'camera-a']);
  });

  it('holds the shown order while the row is focused, so the focused camera stays put', () => {
    const shown = ids(orderCameras(row, (id) => id === 'camera-hall'));
    expect(shown).toEqual(['all-cameras', 'camera-hall', 'camera-front', 'camera-barn', 'camera-garden', 'camera-gate']);
    // A still arrives for camera-gate while the user is on the row: nothing moves.
    expect(ids(keepOrder(row, shown))).toEqual(shown);
    const focusedIndex = shown.indexOf('camera-barn');
    expect(ids(keepOrder(row, shown))[focusedIndex]).toBe('camera-barn');
  });

  it('drops removed cameras and appends new ones when holding the order', () => {
    const shown = ['all-cameras', 'camera-b', 'camera-a', 'camera-gone'];
    expect(ids(keepOrder(tiles('all-cameras', 'camera-a', 'camera-b', 'camera-new'), shown))).toEqual(['all-cameras', 'camera-b', 'camera-a', 'camera-new']);
    expect(ids(keepOrder(tiles('camera-a'), []))).toEqual(['camera-a']);
  });
});
