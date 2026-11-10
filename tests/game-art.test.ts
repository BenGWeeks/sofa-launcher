import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseGameArt, GameArtFetcher, steamAppNumber, steamArtUrls, ART_RETRY_MS } from '../src/main/game-art';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'sofa-art-')); dirs.push(d); return join(d, 'game-art'); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = (bytes: Uint8Array, type = 'image/jpeg', headers: Record<string, string> = {}) =>
  new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type, ...headers } });

describe('Steam app numbers', () => {
  it('accepts digits only and builds both URLs from the number', () => {
    expect(steamAppNumber('1692250')).toBe(1692250);
    for (const bad of ['', '12a', '../1', '1/../2', ' 1', '12345678901', 1692250, null]) expect(steamAppNumber(bad)).toBeNull();
    expect(steamArtUrls(552990)).toEqual([
      'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/552990/header.jpg',
      'https://cdn.cloudflare.steamstatic.com/steam/apps/552990/header.jpg',
    ]);
  });

  it('rejects non-numeric ids without any request', async () => {
    const fetch = vi.fn();
    const art = new GameArtFetcher({ dir: tmp(), enabled: () => true, fetch });
    expect(await art.fetch('../../etc/passwd')).toBeNull();
    expect(await art.fetch('steam-1')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('downloading missing artwork', () => {
  it('saves a JPEG once, privately, and uses the file from then on', async () => {
    const dir = tmp();
    const fetch = vi.fn(async (_url: string) => image(JPEG));
    const art = new GameArtFetcher({ dir, enabled: () => true, fetch });
    const file = await art.fetch('1692250');
    expect(file).toBe(join(dir, '1692250.jpg'));
    expect(new Uint8Array(readFileSync(file!))).toEqual(JPEG);
    expect(statSync(file!).mode & 0o777).toBe(0o600);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(steamArtUrls(1692250)[0]);
    expect(art.cached('1692250')).toBe(file);
    expect(await art.fetch('1692250')).toBe(file);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts PNG, falls back to the second URL, and shares one request between callers', async () => {
    const dir = tmp();
    const fetch = vi.fn(async (url: string) => (url.includes('store_item_assets') ? new Response('', { status: 404 }) : image(PNG, 'image/png')));
    const art = new GameArtFetcher({ dir, enabled: () => true, fetch });
    const [a, b] = await Promise.all([art.fetch('552990'), art.fetch('552990')]);
    expect(a).toBe(join(dir, '552990.png'));
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a wrong content type', () => image(JPEG, 'text/html')],
    ['an image that is not really one', () => image(new Uint8Array([60, 104, 116, 109, 108]), 'image/jpeg')],
    ['a declared oversize body', () => image(JPEG, 'image/jpeg', { 'content-length': '5000000' })],
    ['an oversize body', () => image(new Uint8Array(3_000_000).fill(0xff), 'image/jpeg')],
    ['an HTTP error', () => new Response('', { status: 500 })],
  ])('rejects %s and remembers the failure for a day', async (_name, respond) => {
    const dir = tmp();
    const now = 1_000_000;
    const fetch = vi.fn(async () => respond());
    const art = new GameArtFetcher({ dir, enabled: () => true, fetch, now: () => now });
    expect(await art.fetch('100')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(existsSync(join(dir, '100.jpg'))).toBe(false);
    expect(await art.fetch('100')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    // A new launcher process sees the marker too.
    expect(await new GameArtFetcher({ dir, enabled: () => true, fetch, now: () => now }).fetch('100')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    const later = new GameArtFetcher({ dir, enabled: () => true, fetch, now: () => Date.now() + ART_RETRY_MS + 60_000 });
    await later.fetch('100');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('gives up on a request that takes too long', async () => {
    const fetch = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const art = new GameArtFetcher({ dir: tmp(), enabled: () => true, fetch, timeoutMs: 20 });
    expect(await art.fetch('300')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect away from Steam', async () => {
    const fetch = vi.fn(async () => { const r = image(JPEG); Object.defineProperty(r, 'url', { value: 'https://evil.example/x.jpg' }); return r; });
    expect(await new GameArtFetcher({ dir: tmp(), enabled: () => true, fetch }).fetch('400')).toBeNull();
  });

  it('makes no request at all with fetchArt = false', async () => {
    const fetch = vi.fn();
    const art = new GameArtFetcher({ dir: tmp(), enabled: () => false, fetch });
    expect(await art.fetch('1692250')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('which picture a game tile shows', () => {
  const local = '/steam/appcache/librarycache/552990/abc123/library_header.jpg';
  const downloaded = '/data/game-art/552990.jpg';

  it('prefers the downloaded official header over Steam\'s local cache (which may be an event banner)', () => {
    expect(chooseGameArt({ local, downloaded, fetchEnabled: true })).toEqual({ file: downloaded, fetch: false });
  });

  it('shows the local picture until the download exists, and asks for the download', () => {
    expect(chooseGameArt({ local, fetchEnabled: true })).toEqual({ file: local, fetch: true });
    expect(chooseGameArt({ fetchEnabled: true })).toEqual({ file: undefined, fetch: true });
  });

  it('with fetchArt off, never downloads and shows the local picture first', () => {
    expect(chooseGameArt({ local, downloaded, fetchEnabled: false })).toEqual({ file: local, fetch: false });
    expect(chooseGameArt({ local, fetchEnabled: false })).toEqual({ file: local, fetch: false });
    expect(chooseGameArt({ downloaded, fetchEnabled: false })).toEqual({ file: downloaded, fetch: false });
    expect(chooseGameArt({ fetchEnabled: false })).toEqual({ file: undefined, fetch: false });
  });
});
