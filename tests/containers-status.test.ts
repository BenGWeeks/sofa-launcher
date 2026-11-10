import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContainerStatusSource, readStatusFile, type StatusFileReader } from '../src/main/containers-status';

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  Id: name.padEnd(64, '0').replace(/[^0-9a-f]/g, 'a'), Names: [`/${name}`], Image: 'redis:7', State: 'running', Status: 'Up 1 hour', ...extra,
});
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function fixture(start = 1_000_000) {
  let now = start;
  const results: (() => Promise<{ bytes: Uint8Array; mtimeMs: number }>)[] = [];
  const reader = vi.fn<StatusFileReader>(async () => {
    const next = results.shift();
    if (!next) throw new Error('no more results');
    return next();
  });
  const source = new ContainerStatusSource({ path: '/status/containers.json', reader, now: () => now, timeoutMs: 50 });
  return {
    source, reader,
    ok: (value: unknown, mtimeMs = now) => results.push(async () => ({ bytes: json(value), mtimeMs })),
    raw: (bytes: Uint8Array) => results.push(async () => ({ bytes, mtimeMs: now })),
    fail: (code: string) => results.push(async () => { throw Object.assign(new Error(code), { code }); }),
    hang: () => results.push(() => new Promise(() => undefined)),
    advance: (ms: number) => { now += ms; },
  };
}

describe('containers status file', () => {
  it('requires an absolute path', () => {
    expect(() => new ContainerStatusSource({ path: 'containers.json' })).toThrow();
  });

  it('reads, validates and summarises the file', async () => {
    const f = fixture();
    f.ok([entry('web'), entry('db', { State: 'exited', Status: 'Exited (1) 2 minutes ago' }), { junk: true }]);
    const snap = await f.source.refresh();
    expect(snap).toMatchObject({ configured: true, error: null, stale: false, skipped: 1, modifiedAt: 1_000_000, readAt: 1_000_000 });
    expect(snap.containers.map((c) => [c.name, c.colour])).toEqual([['web', 'green'], ['db', 'red']]);
    expect(f.source.summary()).toBe('red');
    expect(f.reader).toHaveBeenCalledWith('/status/containers.json', 2 * 1024 * 1024);
  });

  it.each([
    ['missing', (f: ReturnType<typeof fixture>) => f.fail('ENOENT'), 'The status file is missing'],
    ['unreadable', (f: ReturnType<typeof fixture>) => f.fail('EACCES'), 'The status file cannot be read (permission denied)'],
    ['not JSON', (f: ReturnType<typeof fixture>) => f.raw(new TextEncoder().encode('<html>')), 'The status file is not valid JSON'],
    ['not UTF-8', (f: ReturnType<typeof fixture>) => f.raw(new Uint8Array([0x5b, 0xff, 0x5d])), 'The status file is not valid JSON'],
    ['not a list', (f: ReturnType<typeof fixture>) => f.ok({ containers: [] }), 'The status file is not a list of containers'],
    ['too large', (f: ReturnType<typeof fixture>) => f.raw(new Uint8Array(2 * 1024 * 1024 + 1)), 'The status file is too large'],
    ['hanging', (f: ReturnType<typeof fixture>) => f.hang(), 'Reading the status file timed out'],
  ])('keeps the last good data when the file is %s', async (_label, breakIt, message) => {
    const f = fixture();
    f.ok([entry('web')]);
    await f.source.refresh();
    f.advance(15_000);
    breakIt(f);
    const snap = await f.source.refresh();
    expect(snap.error).toBe(message);
    expect(snap.containers.map((c) => c.name)).toEqual(['web']);
    expect(snap.readAt).toBe(1_000_000);
    expect(f.source.summary()).toBe('amber');
    // The next good read clears the error.
    f.ok([entry('web'), entry('db')]);
    expect((await f.source.refresh()).error).toBeNull();
  });

  it('reports an error with no data before the first good read', async () => {
    const f = fixture();
    f.fail('ENOENT');
    const snap = await f.source.refresh();
    expect(snap).toMatchObject({ containers: [], error: 'The status file is missing', modifiedAt: null });
    expect(f.source.summary()).toBe('amber'); // set up, but nothing to show: worth a look
  });

  it('flags a file older than a minute as stale', async () => {
    const f = fixture();
    f.ok([entry('web')], 1_000_000 - 30_000);
    expect((await f.source.refresh()).stale).toBe(false);
    f.advance(31_000);
    expect(f.source.snapshot().stale).toBe(true);
    expect(f.source.summary()).toBe('amber');
  });

  it('rate-limits reads and shares a read in progress', async () => {
    const f = fixture();
    f.ok([entry('web')]);
    const [a, b] = await Promise.all([f.source.refresh(), f.source.refresh()]);
    expect(a).toEqual(b);
    expect(f.reader).toHaveBeenCalledTimes(1);
    f.advance(4_000);
    await f.source.refresh(5_000);
    expect(f.reader).toHaveBeenCalledTimes(1);
    f.advance(2_000);
    f.ok([entry('web')]);
    await f.source.refresh(5_000);
    expect(f.reader).toHaveBeenCalledTimes(2);
    expect(f.source.age).toBe(0);
  });
});

describe('readStatusFile (real files)', () => {
  const folders: string[] = [];
  afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
  const folder = () => { const d = mkdtempSync(join(tmpdir(), 'sofa-containers-')); folders.push(d); return d; };

  it('reads the bytes and modification time', async () => {
    const path = join(folder(), 'containers.json');
    writeFileSync(path, '[]');
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    const file = await readStatusFile(path, 100);
    expect(new TextDecoder().decode(file.bytes)).toBe('[]');
    expect(file.mtimeMs).toBe(1_700_000_000_000);
  });

  it('never reads more than the cap', async () => {
    const path = join(folder(), 'big.json');
    writeFileSync(path, 'x'.repeat(500));
    expect((await readStatusFile(path, 100)).bytes.byteLength).toBe(101);
  });

  it('refuses directories and follows symlinks to files', async () => {
    const d = folder();
    mkdirSync(join(d, 'dir'));
    await expect(readStatusFile(join(d, 'dir'), 100)).rejects.toThrow();
    writeFileSync(join(d, 'real.json'), '[1]');
    symlinkSync(join(d, 'real.json'), join(d, 'link.json'));
    expect((await readStatusFile(join(d, 'link.json'), 100)).bytes.byteLength).toBe(3);
  });
});
