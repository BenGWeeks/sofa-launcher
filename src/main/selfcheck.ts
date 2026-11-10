import { readFileSync, readlinkSync } from 'node:fs';

export interface SandboxReport {
  rendererPid: number;
  seccomp: string | null;
  noNewPrivs: string | null;
  ownUserNamespace: boolean;
  osSandboxed: boolean;
}

function statusField(pid: number, name: string): string | null {
  const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(new RegExp(`^${name}:\\s*(\\S+)`, 'm'));
  return m ? m[1]! : null;
}

function userns(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/ns/user`);
  } catch {
    return null;
  }
}

/**
 * OS-level sandbox evidence for a renderer (see spikes/s1-sandbox). process.sandboxed
 * is NOT used: it only reflects Electron's JS-level sandbox and is true even with --no-sandbox.
 */
export function sandboxReport(rendererPid: number): SandboxReport {
  const seccomp = statusField(rendererPid, 'Seccomp');
  const noNewPrivs = statusField(rendererPid, 'NoNewPrivs');
  return {
    rendererPid,
    seccomp,
    noNewPrivs,
    ownUserNamespace: userns(rendererPid) !== userns(process.pid),
    osSandboxed: seccomp === '2' && noNewPrivs === '1',
  };
}
