import { isAbsolute, join, resolve } from 'node:path';

/** Intentionally fixed to the TV user's ~/.config, independent of launcher config. */
export function userSetupPaths(home: string): { directory: string; file: string } {
  if (!isAbsolute(home)) throw new Error('Home directory must be absolute');
  const directory = join(resolve(home), '.config', 'autostart');
  return { directory, file: join(directory, 'sofa-launcher.desktop') };
}

export function autostartDesktopEntry(): string {
  return '[Desktop Entry]\nType=Application\nName=Sofa Launcher\nExec=/usr/bin/sofa-launcher\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n';
}
