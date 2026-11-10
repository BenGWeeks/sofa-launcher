import { describe, expect, it, vi } from 'vitest';
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';
import { cameraLoader } from '../src/renderer/src/lib/camera-loader';
const handle = '01020304-0506-0708-090a-0b0c0d0e0f10';
function fixture() {
  const media = vi.fn(async () => new TextEncoder().encode('#EXTM3U\n'));
  const Loader = cameraLoader({ media });
  const loader = new Loader();
  const callbacks: LoaderCallbacks<LoaderContext> = { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() };
  const context = { url: `https://sofa-camera.invalid/${handle}`, responseType: 'text', rangeStart: 0, rangeEnd: 0 } as LoaderContext;
  return { media, loader, callbacks, context };
}
describe('camera HLS IPC loader', () => {
  it('treats hls.js zero-byte default range as a full-resource request', async () => {
    const f = fixture(); f.loader.load(f.context, {} as LoaderConfiguration, f.callbacks);
    await vi.waitFor(() => expect(f.callbacks.onSuccess).toHaveBeenCalledOnce());
    expect(f.media).toHaveBeenCalledWith(handle, undefined);
    expect(f.callbacks.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ data: '#EXTM3U\n' }), expect.anything(), f.context, null);
  });
  it('forwards real byte ranges and supplies binary data for fragments', async () => {
    const f = fixture();
    f.loader.load({ ...f.context, responseType: 'arraybuffer', rangeStart: 12, rangeEnd: 24 }, {} as LoaderConfiguration, f.callbacks);
    await vi.waitFor(() => expect(f.callbacks.onSuccess).toHaveBeenCalledOnce());
    expect(f.media).toHaveBeenCalledWith(handle, { start: 12, end: 24 });
    expect(vi.mocked(f.callbacks.onSuccess).mock.calls[0]?.[0].data).toBeInstanceOf(ArrayBuffer);
  });
  it('preserves LL-HLS delivery directives on opaque handles for main validation', async () => {
    const f = fixture();
    f.loader.load({ ...f.context, url: f.context.url + '?_HLS_msn=12&_HLS_part=2&_HLS_skip=YES' }, {} as LoaderConfiguration, f.callbacks);
    await vi.waitFor(() => expect(f.callbacks.onSuccess).toHaveBeenCalledOnce());
    expect(f.media).toHaveBeenCalledWith(handle + '?_HLS_msn=12&_HLS_part=2&_HLS_skip=YES', undefined);
  });
  it('rejects external addresses before IPC and ignores completed requests after abort', async () => {
    const f = fixture();
    f.loader.load({ ...f.context, url: 'https://elsewhere.example/private' }, {} as LoaderConfiguration, f.callbacks);
    expect(f.media).not.toHaveBeenCalled();
    expect(f.callbacks.onError).toHaveBeenCalledOnce();
    const next = fixture();
    next.loader.load(next.context, {} as LoaderConfiguration, next.callbacks); next.loader.abort();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(next.callbacks.onSuccess).not.toHaveBeenCalled();
    expect(next.loader.stats.aborted).toBe(true);
  });
});
