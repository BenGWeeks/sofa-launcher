import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, statSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editBackground, editTheme, writeBackground, writeTheme, editBrowser, writeBrowser } from '../src/main/config-writer';
import { parseConfig } from '../src/main/config';

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sofa-theme-'));
  directories.push(dir);
  return { dir, path: join(dir, 'config.toml') };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('theme-only config edits', () => {
  it('preserves comments, whitespace, quoted keys, other sections and CRLF', () => {
    const source = '# TV\r\n[ui] # appearance\r\ndefaultBrowser = "edge"\r\n  "theme" = \'knowall\'  # keep\r\n\r\n[buttons]\r\n# theme = "ignore"\r\n';
    expect(editTheme(source, 'nodie')).toBe(source.replace("'knowall'", '"nodie"'));
  });
  it('adds a key under an existing ui section', () => {
    const source = '[ui]\ndefaultBrowser = "edge"\n[buttons]\n';
    expect(editTheme(source, 'nodie')).toBe('[ui]\ntheme = "nodie"\ndefaultBrowser = "edge"\n[buttons]\n');
  });
  it('adds ui when absent without changing app fields', () => {
    const source = '# apps\n[[apps]]\nid="x"\ncatalogue="netflix"\n';
    const result = editTheme(source, 'nodie');
    expect(result.startsWith(source)).toBe(true);
    expect(parseConfig(result)).toEqual({ ...parseConfig(source), ui: { browser: 'default', theme: 'nodie', background: 'midnight' } });
  });
  it('edits the background without touching the theme or comments', () => {
    const source = '[ui]\ntheme = "nodie" # keep\nbackground = "midnight"\n[buttons]\n';
    expect(editBackground(source, 'planet')).toBe(source.replace('"midnight"', '"planet"'));
    expect(editBackground('[ui]\ntheme = "nodie"\n', 'smoke-right')).toBe('[ui]\nbackground = "smoke-right"\ntheme = "nodie"\n');
    expect(editBackground('[ui]\n', 'moonwalk')).toBe('[ui]\nbackground = "moonwalk"\n');
    expect(() => editBackground('', 'beach')).toThrow('Invalid background');
    expect(() => editBackground('', '../planet')).toThrow('Invalid background');
  });
  it('rejects invalid values and unsafe alternative TOML layouts', () => {
    expect(() => editTheme('', 'orange')).toThrow('Invalid theme');
    expect(() => editTheme('ui = { theme = "knowall" }', 'nodie')).toThrow();
  });
  it.each([0o600, 0o640, 0o644, 0o400])('replaces atomically preserving mode %s with no leftover temp files', (mode) => {
    const { dir, path } = fixture();
    writeFileSync(path, '[ui]\ntheme = "knowall" # keep\n', { mode: 0o600 });
    chmodSync(path, mode);
    const inode = statSync(path).ino;
    writeTheme(path, 'nodie');
    expect(readFileSync(path, 'utf8')).toBe('[ui]\ntheme = "nodie" # keep\n');
    expect(statSync(path).ino).not.toBe(inode);
    expect(statSync(path).mode & 0o777).toBe(mode);
    expect(readdirSync(dir)).toEqual(['config.toml']);
  });
  it('creates a missing config privately', () => {
    const { path } = fixture();
    writeTheme(path, 'nodie');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(parseConfig(readFileSync(path, 'utf8')).ui.theme).toBe('nodie');
  });
  it('refuses symlink targets and parent directories', () => {
    const { dir, path } = fixture();
    const actual = join(dir, 'actual.toml');
    writeFileSync(actual, '');
    symlinkSync(actual, path);
    expect(() => writeTheme(path, 'nodie')).toThrow();
    expect(readFileSync(actual, 'utf8')).toBe('');
    const link = join(dir, 'alias');
    symlinkSync(dir, link);
    expect(() => writeTheme(join(link, 'actual.toml'), 'nodie')).toThrow();
  });
  it('leaves the original untouched on validation failure', () => {
    const { dir, path } = fixture();
    writeFileSync(path, '# keep\n');
    expect(() => writeTheme(path, '../bad')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('# keep\n');
    expect(readdirSync(dir)).toEqual(['config.toml']);
  });
  it('writes the background atomically and keeps the file private', () => {
    const { path } = fixture();
    writeFileSync(path, '[ui]\ntheme = "nodie"\n', { mode: 0o600 });
    writeBackground(path, 'nebula');
    expect(parseConfig(readFileSync(path, 'utf8')).ui).toMatchObject({ theme: 'nodie', background: 'nebula' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => writeBackground(path, 'beach')).toThrow('Invalid background');
  });
});


describe('browser config edits', () => {
  it('preserves legacy keys, comments, app overrides and HA addresses', () => {
    const source = '[ui] # keep\ndefaultBrowser = "edge"\n[[apps]]\nid="homeassistant"\ncatalogue="homeassistant"\nurl="https://ha.example.com"\nbrowser="brave"\n';
    const edited = editBrowser(source, 'chrome');
    expect(edited).toBe(source.replace('[ui] # keep', '[ui] # keep\nbrowser = "chrome"'));
    expect(parseConfig(edited).ui.browser).toBe('chrome');
    expect(parseConfig(edited).apps).toEqual(parseConfig(source).apps);
    expect(() => editBrowser(source, '/tmp/browser')).toThrow('Invalid browser');
  });
  it('writes browser using the atomic config writer', () => {
    const { path } = fixture();
    writeFileSync(path, '# keep\n[ui]\nbrowser="default" # choice\n', { mode: 0o600 });
    writeBrowser(path, 'vivaldi');
    expect(readFileSync(path, 'utf8')).toBe('# keep\n[ui]\nbrowser="vivaldi" # choice\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
