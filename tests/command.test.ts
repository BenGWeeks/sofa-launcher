import { describe, expect, it } from 'vitest';
import { MAX_SEARCH, parseOpenCommand, sanitizeSearch, searchUrl, validateOpenCommand } from '../src/main/command';
import { parseConfig, SEED_CONFIG } from '../src/main/config';

const apps = parseConfig(SEED_CONFIG).apps;
const app = (id: string) => apps.find((a) => a.id === id)!;

describe('parseOpenCommand', () => {
  it('returns null when there is no open command (a plain second launch)', () => {
    expect(parseOpenCommand(['/usr/bin/sofa-launcher'])).toBeNull();
    expect(parseOpenCommand(['electron', '.', '--dev', '--no-sandbox'])).toBeNull();
  });

  it('parses open <appId>, ignoring whatever electron put before it', () => {
    expect(parseOpenCommand(['/opt/sofa-launcher/sofa-launcher', '--some-flag', 'open', 'netflix'])).toEqual({
      ok: true, command: { appId: 'netflix' },
    });
  });

  it('parses --search in both spellings', () => {
    expect(parseOpenCommand(['x', 'open', 'netflix', '--search', 'The Crown'])).toEqual({
      ok: true, command: { appId: 'netflix', search: 'The Crown' },
    });
    expect(parseOpenCommand(['x', 'open', 'youtube', '--search=Bluey'])).toEqual({
      ok: true, command: { appId: 'youtube', search: 'Bluey' },
    });
  });

  it('copes with Chromium moving switches ahead of positional arguments (second-instance argv)', () => {
    expect(parseOpenCommand(['/usr/bin/sofa-launcher', '--search', '--no-sandbox', 'open', 'netflix', 'The Crown'])).toEqual({
      ok: true, command: { appId: 'netflix', search: 'The Crown' },
    });
    expect(parseOpenCommand(['sofa-launcher', '--search=Bluey', 'open', 'youtube'])).toEqual({
      ok: true, command: { appId: 'youtube', search: 'Bluey' },
    });
  });

  it('does not mistake a search for "open" as the command', () => {
    expect(parseOpenCommand(['x', 'open', 'netflix', '--search', 'open'])).toEqual({
      ok: true, command: { appId: 'netflix', search: 'open' },
    });
  });

  it.each([
    ['a missing app id', ['x', 'open']],
    ['an app id that is a flag', ['x', 'open', '--search', 'y']],
    ['an app id with odd characters', ['x', 'open', '../etc/passwd']],
    ['an app id with spaces', ['x', 'open', 'net flix']],
    ['unknown arguments', ['x', 'open', 'netflix', '--exec', 'rm']],
    ['stray words with an inline search', ['x', 'open', 'netflix', '--search=a', 'b']],
    ['--search without text', ['x', 'open', 'netflix', '--search']],
    ['an empty search', ['x', 'open', 'netflix', '--search', '   ']],
    ['a search over the limit', ['x', 'open', 'netflix', '--search', 'a'.repeat(MAX_SEARCH + 1)]],
  ])('rejects %s', (_label, argv) => {
    const r = parseOpenCommand(argv);
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(false);
  });
});

describe('validateOpenCommand (from a second instance)', () => {
  it('passes a well-formed command through and re-sanitises the search', () => {
    expect(validateOpenCommand(parseOpenCommand(['x', 'open', 'netflix', '--search', ' The Crown\n']))).toEqual({
      ok: true, command: { appId: 'netflix', search: 'The Crown' },
    });
    expect(validateOpenCommand(null)).toBeNull();
    expect(validateOpenCommand(undefined)).toBeNull();
  });
  it('rejects anything malformed instead of trusting the other process', () => {
    for (const bad of ['open', 42, {}, { ok: true }, { ok: true, command: { appId: '../x' } }, { ok: true, command: { appId: 'netflix', search: 7 } },
      { ok: true, command: { appId: 'netflix', search: 'a'.repeat(MAX_SEARCH + 1) } }]) {
      const r = validateOpenCommand(bad);
      expect(r, JSON.stringify(bad)).not.toBeNull();
      expect(r!.ok).toBe(false);
    }
    expect(validateOpenCommand({ ok: false, error: 'boom' })).toEqual({ ok: false, error: 'boom' });
  });
});

describe('sanitizeSearch', () => {
  it('strips control characters and trims', () => {
    expect(sanitizeSearch('  The\u0000 Crown\n\t')).toBe('The Crown');
    expect(sanitizeSearch('\u001b[31mred')).toBe('[31mred');
  });
  it('keeps unicode and punctuation', () => {
    expect(sanitizeSearch('Amélie & "Zoë" <3')).toBe('Amélie & "Zoë" <3');
  });
  it('accepts exactly the limit and rejects one more', () => {
    expect(sanitizeSearch('a'.repeat(MAX_SEARCH))).toHaveLength(MAX_SEARCH);
    expect(sanitizeSearch('a'.repeat(MAX_SEARCH + 1))).toBeNull();
  });
});

describe('searchUrl', () => {
  it('builds the per-service URLs, URL-encoded', () => {
    expect(searchUrl(app('netflix'), 'The Crown')).toBe('https://www.netflix.com/search?q=The%20Crown');
    expect(searchUrl(app('prime'), 'Clarkson’s Farm')).toBe('https://www.primevideo.com/search?phrase=Clarkson%E2%80%99s%20Farm');
    expect(searchUrl(app('youtube'), 'Bluey & Bingo')).toBe('https://www.youtube.com/tv#/search?q=Bluey%20%26%20Bingo');
  });

  it('encodes characters that could break out of the query', () => {
    expect(searchUrl(app('netflix'), 'a?b=c&d#e/f')).toBe('https://www.netflix.com/search?q=a%3Fb%3Dc%26d%23e%2Ff');
  });

  it('returns null for apps without a search page or an empty query', () => {
    expect(searchUrl(app('homeassistant'), 'lights')).toBeNull();
    expect(searchUrl(app('jellyfin'), 'x')).toBeNull();
    expect(searchUrl(app('netflix'), '\u0001')).toBeNull();
  });

  it('honours a searchUrl override in config', () => {
    const c = parseConfig('[[apps]]\nid = "nf"\ncatalogue = "netflix"\nsearchUrl = "https://example.com/s?q="');
    expect(searchUrl(c.apps[0]!, 'x y')).toBe('https://example.com/s?q=x%20y');
  });
});
