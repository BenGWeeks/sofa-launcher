import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';
import { parseConfig } from './config';
import type { Background, Theme } from '@shared/types';
import { BROWSER_IDS, type BrowserChoice } from '../shared/browsers';
import { BACKGROUND_IDS } from '@shared/backgrounds';

export function validateTheme(value: unknown): Theme {
  if (value !== 'knowall' && value !== 'nodie') throw new Error('Invalid theme');
  return value;
}

export function validateBackground(value: unknown): Background {
  if (typeof value !== 'string' || !(BACKGROUND_IDS as readonly string[]).includes(value)) throw new Error('Invalid background');
  return value as Background;
}

/** Preserve comments, spacing and every other key. Refuse unusual TOML we cannot edit safely. */
function editUiString(source: string, name: 'theme' | 'background' | 'browser', value: string): string {
  parseConfig(source);
  const keyPattern = `(?:${name}|"${name}"|'${name}')`;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\[\s*ui\s*\]\s*(?:#.*)?$/.test(line));
  if (start < 0) {
    lines.push('', '[ui]', `${name} = "${value}"`, '');
  } else {
    let end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
    const key = lines.findIndex((line, i) => i > start && i < end && new RegExp(`^\\s*${keyPattern}\\s*=`).test(line));
    if (key < 0) lines.splice(start + 1, 0, `${name} = "${value}"`);
    else lines[key] = lines[key]!.replace(new RegExp(`^(\\s*${keyPattern}\\s*=\\s*)(?:"[^"]*"|'[^']*')`), `$1"${value}"`);
  }
  const edited = lines.join(newline);
  const expected = parse(source);
  const ui = (expected.ui ?? parse('')) as ReturnType<typeof parse>;
  ui[name] = value;
  expected.ui = ui;
  if (!isDeepStrictEqual(parse(edited), expected)) throw new Error(`Cannot safely edit ui.${name} in this TOML layout`);
  parseConfig(edited);
  return edited;
}

export function editTheme(source: string, value: unknown): string {
  return editUiString(source, 'theme', validateTheme(value));
}

export function editBackground(source: string, value: unknown): string {
  return editUiString(source, 'background', validateBackground(value));
}

/** Walk directories with O_NOFOLLOW and keep the final directory pinned across read + rename (Linux). */
function openDirectory(path: string): number {
  let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of resolve(path).split('/').filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(fd);
      fd = next;
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Atomic replacement, exclusive random temp file, preserved permissions; no symlink targets or parents. */
export function writeTheme(path: string, value: unknown): void {
  validateTheme(value);
  writeEdited(path, (source) => editTheme(source, value));
}

export function writeBackground(path: string, value: unknown): void {
  validateBackground(value);
  writeEdited(path, (source) => editBackground(source, value));
}

function writeEdited(path: string, edit: (source: string) => string): void {
  writeFileAtomic(path, edit);
}

/**
 * Read a regular file (never through a symlink, at any level of its path); null if it doesn't exist.
 * Throws if it is something else, or bigger than `maxBytes`.
 */
export function readFileSafely(path: string, maxBytes = 1_000_000): string | null {
  const directory = openDirectory(dirname(path));
  try {
    return readPinned(`/proc/self/fd/${directory}/${basename(path)}`, maxBytes)?.source ?? null;
  } finally { closeSync(directory); }
}

function readPinned(target: string, maxBytes: number): { source: string; mode: number } | null {
  let fd: number;
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Config must be a regular file');
    if (stat.size > maxBytes) throw new Error('File is too large');
    return { source: readFileSync(fd, 'utf8'), mode: stat.mode & 0o777 };
  } finally { closeSync(fd); }
}

/**
 * Atomic replacement: exclusive random temp file in the same (pinned) directory, fsync, rename.
 * Refuses symlinked targets and parents. Keeps the existing file's permissions unless `mode` is
 * given; new files are 0600. `edit` gets the current text ("" if none) and returns the new content.
 */
export function writeFileAtomic(path: string, edit: (source: string) => string | Uint8Array, opts: { mode?: number; maxBytes?: number } = {}): void {
  const directory = openDirectory(dirname(path));
  const target = `/proc/self/fd/${directory}/${basename(path)}`;
  const temp = `/proc/self/fd/${directory}/.config-${randomUUID()}.tmp`;
  try {
    const existing = readPinned(target, opts.maxBytes ?? 10_000_000);
    const mode = opts.mode ?? existing?.mode ?? 0o600;
    const edited = edit(existing?.source ?? '');
    const out = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(out, mode);
      writeFileSync(out, edited);
      fsyncSync(out);
    } finally { closeSync(out); }
    try {
      if (lstatSync(target).isSymbolicLink()) throw new Error('Config must not be a symlink');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    renameSync(temp, target);
    fsyncSync(directory);
  } finally {
    try { unlinkSync(temp); } catch { /* renamed or never created */ }
    closeSync(directory);
  }
}

export function validateBrowser(value: unknown): BrowserChoice {
  if (value !== 'default' && !(BROWSER_IDS as readonly unknown[]).includes(value)) throw new Error('Invalid browser');
  return value as BrowserChoice;
}

export function editBrowser(source: string, value: unknown): string {
  return editUiString(source, 'browser', validateBrowser(value));
}

export function writeBrowser(path: string, value: unknown): void {
  validateBrowser(value);
  writeEdited(path, (source) => editBrowser(source, value));
}
