import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { NAME_PATTERN, type RestartResult } from '@shared/containers';

export interface Restarter {
  /** May this account make this request (restart, or update) right now? */
  available(): Promise<boolean>;
  restart(name: string): Promise<RestartResult>;
}

export type ServiceVerb = 'restart' | 'update';

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

  /** `verb`: the one request this socket grants ("restart", or "update" for the update socket). */
  constructor(readonly path: string, private readonly timeoutMs = 150_000, readonly verb: ServiceVerb = 'restart') {
    if (!path.startsWith('/')) throw new Error(`The ${verb} socket must be an absolute path`);
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
    if (this.busy) return { ok: false, message: `Another ${this.verb} is still running` };
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
      const verb = this.verb;
      const timer = setTimeout(() => done({ ok: false, message: `The ${verb} service did not answer in time` }), this.timeoutMs);
      const finish = () => {
        const line = reply.split('\n')[0]!.trim();
        if (line === 'ok') done({ ok: true, message: verb === 'update' ? 'Updated' : 'Restarted' });
        // "ok <what happened>" (an update: "already up to date", say), shown as a sentence.
        else if (line.startsWith('ok ')) { const said = clean(line.slice(3)); done({ ok: true, message: said ? said[0]!.toUpperCase() + said.slice(1) : 'Done' }); }
        else if (line.startsWith('error ')) done({ ok: false, message: clean(line.slice(6)) || `The ${verb} failed` });
        else done({ ok: false, message: `The ${verb} service gave no answer` });
      };
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${verb} ${name}\n`));
      socket.on('data', (chunk: string) => {
        reply += chunk;
        if (reply.includes('\n') || reply.length > 512) finish();
      });
      socket.on('end', finish);
      socket.on('error', (e: NodeJS.ErrnoException) => done({
        ok: false,
        message: e.code === 'EACCES' ? `This account may not ${verb} containers`
          : e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? `The ${verb} service is not running`
          : `The ${verb} service could not be reached`,
      }));
    });
  }
}
