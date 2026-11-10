import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NO_CHOICES, isShown, parseHomeVisibility, readHomeVisibility, serializeHomeVisibility, withChoice, writeHomeChoice,
} from '../src/main/home-visibility';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'sofa-home-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('home.json parsing', () => {
  it('reads hidden and shown ids', () => {
    const v = parseHomeVisibility('{"version":1,"hidden":["netflix","steam-552990","camera-front-door"],"shown":["disney"]}');
    expect([...v.hidden]).toEqual(['netflix', 'steam-552990', 'camera-front-door']);
    expect([...v.shown]).toEqual(['disney']);
  });

  it.each([
    ['not JSON', '{hidden: [netflix'],
    ['an array', '["netflix"]'],
    ['null', 'null'],
    ['a string', '"netflix"'],
    ['empty', ''],
  ])('treats %s as no choices', (_name, text) => {
    expect(parseHomeVisibility(text)).toEqual(NO_CHOICES);
  });

  it('drops invalid entries one by one and ignores unknown keys', () => {
    const v = parseHomeVisibility(JSON.stringify({ hidden: ['ok', '../etc', 'UPPER', 42, null, 'a'.repeat(65)], shown: 'disney', extra: true }));
    expect([...v.hidden]).toEqual(['ok']);
    expect(v.shown.size).toBe(0);
  });

  it('counts an id in both lists as hidden', () => {
    const v = parseHomeVisibility('{"hidden":["netflix"],"shown":["netflix","disney"]}');
    expect(isShown(v, 'netflix', true)).toBe(false);
    expect([...v.shown]).toEqual(['disney']);
  });

  it('round-trips through its serialised form, sorted', () => {
    const v = { hidden: new Set(['b', 'a']), shown: new Set(['c']) };
    expect(serializeHomeVisibility(v)).toBe('{\n  "version": 1,\n  "hidden": [\n    "a",\n    "b"\n  ],\n  "shown": [\n    "c"\n  ]\n}\n');
    expect(parseHomeVisibility(serializeHomeVisibility(v))).toEqual({ hidden: new Set(['a', 'b']), shown: new Set(['c']) });
  });
});

describe('precedence over config.toml', () => {
  const v = parseHomeVisibility('{"hidden":["netflix"],"shown":["disney"]}');
  it('a stored choice wins either way', () => {
    expect(isShown(v, 'netflix', true)).toBe(false);
    expect(isShown(v, 'disney', false)).toBe(true);
  });
  it('without a choice, config.toml decides', () => {
    expect(isShown(v, 'youtube', true)).toBe(true);
    expect(isShown(v, 'iplayer', false)).toBe(false);
  });
  it('stores only choices that differ from the default', () => {
    const hidden = withChoice(NO_CHOICES, 'netflix', false, true);
    expect([...hidden.hidden]).toEqual(['netflix']);
    expect(withChoice(hidden, 'netflix', true, true)).toEqual(NO_CHOICES);
    expect([...withChoice(NO_CHOICES, 'disney', true, false).shown]).toEqual(['disney']);
    expect(() => withChoice(NO_CHOICES, '../x', true, false)).toThrow();
  });
});

describe('home.json on disk', () => {
  it('a missing file means no choices', () => {
    expect(readHomeVisibility(join(tmp(), 'home.json'))).toEqual(NO_CHOICES);
  });

  it('a malformed file means no choices and is replaced on the next save', () => {
    const path = join(tmp(), 'home.json');
    writeFileSync(path, '{ broken');
    expect(readHomeVisibility(path)).toEqual(NO_CHOICES);
    writeHomeChoice(path, 'netflix', false, true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, hidden: ['netflix'], shown: [] });
  });

  it('writes atomically with mode 600 and keeps other choices', () => {
    const dir = tmp();
    const path = join(dir, 'home.json');
    writeHomeChoice(path, 'netflix', false, true);
    const result = writeHomeChoice(path, 'disney', true, false);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(result).toEqual({ hidden: new Set(['netflix']), shown: new Set(['disney']) });
    expect(readHomeVisibility(path)).toEqual(result);
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
  });

  it('never reads or writes through a symlink', () => {
    const dir = tmp();
    const real = join(dir, 'elsewhere.json');
    writeFileSync(real, '{"hidden":["netflix"]}');
    const path = join(dir, 'home.json');
    symlinkSync(real, path);
    expect(readHomeVisibility(path)).toEqual(NO_CHOICES);
    expect(() => writeHomeChoice(path, 'youtube', false, true)).toThrow();
    expect(readFileSync(real, 'utf8')).toBe('{"hidden":["netflix"]}');
  });

  it('refuses a symlinked parent directory', () => {
    const dir = tmp();
    const target = join(dir, 'real');
    const link = join(dir, 'link');
    mkdirSync(target);
    symlinkSync(target, link);
    expect(() => writeHomeChoice(join(link, 'home.json'), 'netflix', false, true)).toThrow();
    expect(existsSync(join(target, 'home.json'))).toBe(false);
  });

  it('treats an oversized file as no choices', () => {
    const path = join(tmp(), 'home.json');
    writeFileSync(path, JSON.stringify({ hidden: ['netflix'], pad: 'x'.repeat(300_000) }));
    expect(readHomeVisibility(path)).toEqual(NO_CHOICES);
  });
});
