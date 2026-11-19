import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { NAME_PATTERN, type RestartResult } from '@shared/containers';

export interface Restarter {
  /** May this account restart containers right now? */
  available(): Promise<boolean>;
  restart(name: string): Promise<RestartResult>;
}

/** Printable text only, capped: the service's reply is shown on screen. */
const clean = (text: string) => text.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 120);

/**
 * Client of the restart service: a root-owned systemd socket on this machine that restarts one
 * named container and does nothing else. The launcher still never talks to Docker.
 *
 * Who may restart is decided by the system, not here: the socket file's group. An account
 * outside that group cannot open it, so `available` is false and the view offers no restart.
 *
 * Protocol: send "restart <name>\n"; the reply is one line, "ok" or "error <reason>".
 */
export class ContainerRestarter implements Restarter {
  private busy = false;

  constructor(readonly path: string, private readonly timeoutMs = 150_000) {
    if (!path.startsWith('/')) throw new Error('The restart socket must be an absolute path');
  }

  async available(): Promise<boolean> {
    try {
      if (!(await stat(this.path)).isSocket()) return false;
      await access(this.path, constants.R_OK | constants.W_OK);
      return true;
    } catch { return false; }
  }

  async restart(name: string): Promise<RestartResult> {
    if (!NAME_PATTERN.test(name)) return { ok: false, message: 'That is not a container name' };
    if (this.busy) return { ok: false, message: 'Another restart is still running' };
    this.busy = true;
    try { return await this.ask(name); } finally { this.busy = false; }
  }

  private ask(name: string): Promise<RestartResult> {
    return new Promise((resolve) => {
      let reply = '';
      let settled = false;
      const socket = connect(this.path);
      const done = (result: RestartResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => done({ ok: false, message: 'The restart service did not answer in time' }), this.timeoutMs);
      const finish = () => {
        const line = reply.split('\n')[0]!.trim();
        if (line === 'ok') done({ ok: true, message: 'Restarted' });
        else if (line.startsWith('error ')) done({ ok: false, message: clean(line.slice(6)) || 'The restart failed' });
        else done({ ok: false, message: 'The restart service gave no answer' });
      };
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`restart ${name}\n`));
      socket.on('data', (chunk: string) => {
        reply += chunk;
        if (reply.includes('\n') || reply.length > 512) finish();
      });
      socket.on('end', finish);
      socket.on('error', (e: NodeJS.ErrnoException) => done({
        ok: false,
        message: e.code === 'EACCES' ? 'This account may not restart containers'
          : e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'The restart service is not running'
          : 'The restart service could not be reached',
      }));
    });
  }
}
