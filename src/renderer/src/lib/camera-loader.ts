import type { Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js';
import type { CameraApi } from '@shared/camera-types';

/** HLS traffic travels through the owning window's scoped IPC, never the network. */
export function cameraLoader(api: Pick<CameraApi, 'media'>) {
  return class CameraLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null;
    stats: LoaderStats = {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
    };
    private aborted = false;
    abort(): void { this.aborted = true; this.stats.aborted = true; }
    destroy(): void { this.abort(); }
    load(context: LoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
      this.context = context;
      this.aborted = false;
      this.stats.loading.start = performance.now();
      const url = new URL(context.url);
      if (url.origin !== 'https://sofa-camera.invalid' || !/^\/[0-9a-f-]{36}$/.test(url.pathname) || url.search.length > 256 || url.hash) {
        callbacks.onError({ code: 0, text: 'Invalid camera media address' }, context, null, this.stats);
        return;
      }
      const range = Number.isSafeInteger(context.rangeStart) && Number.isSafeInteger(context.rangeEnd) && context.rangeStart! >= 0 && context.rangeEnd! > context.rangeStart! ? { start: context.rangeStart!, end: context.rangeEnd! } : undefined;
      void api.media(url.pathname.slice(1) + url.search, range).then(bytes => {
        if (this.aborted) return;
        this.stats.loading.first = this.stats.loading.end = performance.now();
        this.stats.loaded = this.stats.total = bytes.byteLength;
        const data = context.responseType === 'arraybuffer' ? Uint8Array.from(bytes).buffer : new TextDecoder().decode(bytes);
        callbacks.onSuccess({ url: context.url, data, code: 200 }, this.stats, context, null);
      }).catch(() => {
        if (!this.aborted) callbacks.onError({ code: 0, text: 'Camera media is unavailable' }, context, null, this.stats);
      });
    }
  };
}
