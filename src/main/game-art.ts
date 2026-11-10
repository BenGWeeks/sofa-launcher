/**
 * Header artwork for Steam games that have none cached locally, downloaded once from Steam's
 * public image server into the launcher's own data directory (`<dataDir>/game-art/<appid>.jpg`).
 * Only the game's public Steam number is sent. Failures are remembered (a `<appid>.failed`
 * marker) so a game is retried at most once a day, across restarts too.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './config-writer';

export const ART_TIMEOUT_MS = 5000;
export const ART_MAX_BYTES = 2_000_000;
export const ART_RETRY_MS = 24 * 60 * 60 * 1000;
const STEAM_HOSTS = /^(?:[a-z0-9-]+\.)*steamstatic\.com$/;

type Fetch = (url: string, init: { signal: AbortSignal; redirect: 'follow'; headers: Record<string, string> }) => Promise<Response>;

/** A Steam app id: digits only, as a safe integer. Null for anything else. */
export function steamAppNumber(appId: unknown): number | null {
  if (typeof appId !== 'string' || !/^\d{1,10}$/.test(appId)) return null;
  const n = Number(appId);
  return Number.isSafeInteger(n) ? n : null;
}

/** The two public header URLs, built from the validated number only. */
export function steamArtUrls(appNumber: number): string[] {
  if (!Number.isSafeInteger(appNumber) || appNumber < 0) throw new Error('Invalid Steam app id');
  const id = String(appNumber);
  return [
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
  ];
}

function imageKind(bytes: Uint8Array): 'jpg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

/** The body, or null if the response is not a JPEG/PNG of at most `max` bytes. Stops reading past the limit. */
async function readImage(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.ok) return null;
  if (res.url) {
    try { if (!STEAM_HOSTS.test(new URL(res.url).hostname) || new URL(res.url).protocol !== 'https:') return null; } catch { return null; }
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'image/jpeg' && type !== 'image/png') return null;
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > max) return null;
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

export class GameArtFetcher {
  private pending = new Map<number, Promise<string | null>>();
  /** Failures this session (in case the marker file can't be written). */
  private failures = new Map<number, number>();

  constructor(private opts: {
    dir: string;
    /** `[games] fetchArt`; read on every request, so turning it off stops all requests. */
    enabled: () => boolean;
    fetch?: Fetch;
    now?: () => number;
    timeoutMs?: number;
    maxBytes?: number;
  }) {}

  /** A previously downloaded file for this game, if any. */
  cached(appId: string): string | undefined {
    const n = steamAppNumber(appId);
    if (n === null) return undefined;
    return ['jpg', 'png'].map((ext) => join(this.opts.dir, `${n}.${ext}`)).find((file) => existsSync(file));
  }

  private failedRecently(n: number): boolean {
    const now = (this.opts.now ?? Date.now)();
    const failed = this.failures.get(n);
    if (failed !== undefined && now - failed < ART_RETRY_MS) return true;
    try {
      return now - statSync(join(this.opts.dir, `${n}.failed`)).mtimeMs < ART_RETRY_MS;
    } catch { return false; }
  }

  /**
   * Download the header unless it is cached, failed within a day, disabled, or already on its way.
   * Resolves to the saved file, or null. Never rejects.
   */
  fetch(appId: string): Promise<string | null> {
    const n = steamAppNumber(appId);
    if (n === null || !this.opts.enabled()) return Promise.resolve(null);
    const cached = this.cached(appId);
    if (cached) return Promise.resolve(cached);
    if (this.failedRecently(n)) return Promise.resolve(null);
    const pending = this.pending.get(n);
    if (pending) return pending;
    const job = this.download(n).catch(() => null).finally(() => this.pending.delete(n));
    this.pending.set(n, job);
    return job;
  }

  private async download(n: number): Promise<string | null> {
    const fetcher: Fetch = this.opts.fetch ?? ((url, init) => fetch(url, init));
    for (const url of steamArtUrls(n)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? ART_TIMEOUT_MS);
      try {
        const res = await fetcher(url, { signal: controller.signal, redirect: 'follow', headers: { accept: 'image/jpeg,image/png' } });
        const bytes = await readImage(res, this.opts.maxBytes ?? ART_MAX_BYTES);
        const kind = bytes && imageKind(bytes);
        if (bytes && kind) {
          mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
          const file = join(this.opts.dir, `${n}.${kind}`);
          writeFileAtomic(file, () => bytes, { mode: 0o600 });
          return file;
        }
      } catch {
        /* try the next URL */
      } finally {
        clearTimeout(timer);
      }
    }
    this.failures.set(n, (this.opts.now ?? Date.now)());
    try {
      mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(join(this.opts.dir, `${n}.failed`), () => '', { mode: 0o600 });
    } catch { /* remembered for this session only */ }
    return null;
  }
}
