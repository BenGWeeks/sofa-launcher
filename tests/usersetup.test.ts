import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { autostartDesktopEntry, userSetupPaths } from '../src/main/usersetup';
import { setupUser } from '../src/main/usersetup-io';

const homes: string[] = [];
function home(): string {
  const path = mkdtempSync(join(process.cwd(), '.usersetup-test-'));
  homes.push(path);
  return path;
}
afterEach(() => { for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('user setup plans', () => {
  it('builds the fixed desktop entry', () => {
    expect(autostartDesktopEntry()).toBe('[Desktop Entry]\nType=Application\nName=Sofa Launcher\nExec=/usr/bin/sofa-launcher\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n');
  });
  it('resolves the user autostart path including spaces', () => {
    expect(userSetupPaths('/home/TV User')).toEqual({ directory: '/home/TV User/.config/autostart', file: '/home/TV User/.config/autostart/sofa-launcher.desktop' });
    expect(() => userSetupPaths('relative')).toThrow('absolute');
  });
});
describe('user setup filesystem boundary', () => {
  it('creates directories and file, preserves an existing file, and undoes idempotently', () => {
    const root = home();
    const { file } = userSetupPaths(root);
    expect(setupUser(root)).toContain('Created:');
    expect(readFileSync(file, 'utf8')).toBe(autostartDesktopEntry());
    writeFileSync(file, 'custom');
    expect(setupUser(root)).toContain('unchanged');
    expect(readFileSync(file, 'utf8')).toBe('custom');
    expect(setupUser(root, true)).toContain('Removed:');
    expect(existsSync(file)).toBe(false);
    expect(setupUser(root, true)).toContain('Already absent:');
  });
  it('undo does not create missing directories', () => {
    const root = home();
    expect(setupUser(root, true)).toContain('Already absent:');
    expect(existsSync(join(root, '.config'))).toBe(false);
  });
  it.each(['home', '.config', 'autostart', 'file'])('does not follow a symlink at %s', (where) => {
    const root = home();
    const target = join(root, 'target');
    mkdirSync(target);
    let testHome = root;
    if (where === 'home') { testHome = join(root, 'link'); symlinkSync(target, testHome); }
    else if (where === '.config') symlinkSync(target, join(root, '.config'));
    else {
      mkdirSync(join(root, '.config'));
      if (where === 'autostart') symlinkSync(target, join(root, '.config/autostart'));
      else {
        mkdirSync(join(root, '.config/autostart'));
        writeFileSync(join(target, 'sentinel'), 'untouched');
        symlinkSync(join(target, 'sentinel'), userSetupPaths(root).file);
      }
    }
    expect(() => setupUser(testHome)).toThrow();
    if (where === 'file') {
      expect(setupUser(root, true)).toContain('Removed:');
      expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('untouched');
    } else expect(() => setupUser(testHome, true)).toThrow();
    expect(existsSync(join(target, 'sofa-launcher.desktop'))).toBe(false);
  });
});
