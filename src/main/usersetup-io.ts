import { constants, closeSync, fstatSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { parse } from 'node:path';
import { autostartDesktopEntry, userSetupPaths } from './usersetup';

/** Linux directory-fd traversal: O_NOFOLLOW applies to every component, even
 * if a directory is renamed between operations. Never open/truncate a link target.
 * Creation uses O_EXCL, so existing files (including hard links) are untouched.
 */
export function setupUser(home: string, undo = false): string {
  const { directory, file } = userSetupPaths(home);
  const root = parse(directory).root;
  let fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of directory.slice(root.length).split('/').filter(Boolean)) {
      const child = `/proc/self/fd/${fd}/${part}`;
      if (!undo) {
        try { mkdirSync(child, { mode: 0o755 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      let next: number;
      try { next = openSync(child, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
      catch (error) {
        if (undo && (error as NodeJS.ErrnoException).code === 'ENOENT') return `Already absent: ${file}`;
        throw error;
      }
      closeSync(fd);
      fd = next;
    }
    const entry = `/proc/self/fd/${fd}/sofa-launcher.desktop`;
    if (undo) {
      // unlink removes a link itself; it never follows it.
      try { unlinkSync(entry); return `Removed: ${file}`; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `Already absent: ${file}`;
        throw error;
      }
    }
    let output: number;
    try { output = openSync(entry, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Inspect via O_PATH: neither symlinks nor special files are opened for I/O.
      const existing = openSync(entry, 0x200000 | constants.O_NOFOLLOW); // Linux O_PATH
      try {
        if (!fstatSync(existing).isFile()) throw new Error(`Refusing non-regular autostart file: ${file}`);
      } finally { closeSync(existing); }
      return `Already exists (unchanged): ${file}`;
    }
    try { writeFileSync(output, autostartDesktopEntry()); }
    finally { closeSync(output); }
    return `Created: ${file}`;
  } finally { closeSync(fd); }
}
