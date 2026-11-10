import { describe, expect, it, vi } from 'vitest';
import { CameraPreview } from '../src/renderer/src/lib/camera-preview';
describe('camera still to live transition', () => {
  it('shows the still while connecting and fades only when a frame arrives', async () => {
    const changed = vi.fn(); const preview = new CameraPreview(changed);
    preview.start(async () => 'data:image/jpeg;base64,fixture');
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith('data:image/jpeg;base64,fixture', false);
    preview.frame();
    expect(changed).toHaveBeenLastCalledWith(null, true);
  });
  it('ignores snapshots arriving after a live frame, stop, or retry', async () => {
    for (const action of ['frame', 'stop', 'retry']) {
      const changed = vi.fn(); const preview = new CameraPreview(changed);
      let resolve!: (value: string) => void;
      preview.start(() => new Promise<string>(done => { resolve = done; }));
      if (action === 'frame') preview.frame();
      else if (action === 'stop') preview.stop();
      else preview.start(async () => null);
      changed.mockClear(); resolve('stale'); await Promise.resolve();
      expect(changed).not.toHaveBeenCalledWith('stale', false);
    }
  });
  it('allows live video after a failed snapshot', async () => {
    const changed = vi.fn(); const preview = new CameraPreview(changed);
    preview.start(async () => { throw new Error('offline'); });
    await Promise.resolve(); await Promise.resolve(); preview.frame();
    expect(changed).toHaveBeenLastCalledWith(null, true);
  });
});
