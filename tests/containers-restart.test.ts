import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContainerRestarter } from '../src/main/containers-restart';
import { parseEntry } from '../src/shared/containers';

const dirs: string[] = [];
const servers: Server[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'sofa-restart-')); dirs.push(d); return d; };
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A stand-in restart service: records each request line and answers with `answer`. */
async function service(answer: (line: string) => string | null, mode = 0o660) {
  const path = join(temp(), 'restart.sock');
  const seen: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.on('data', (line: string) => { seen.push(line); const a = answer(line); if (a !== null) socket.end(a); });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  chmodSync(path, mode);
  return { path, seen };
}

describe('restart service client', () => {
  it('asks for one container by name and reports success', async () => {
    const s = await service(() => 'ok\n');
    const r = new ContainerRestarter(s.path);
    expect(await r.available()).toBe(true);
    expect(await r.restart('sonarr')).toEqual({ ok: true, message: 'Restarted' });
    expect(s.seen).toEqual(['restart sonarr\n']);
  });

  it('passes on the service’s reason, cleaned for the screen', async () => {
    const s = await service(() => 'error this container is protected\u001b[31m from restarts\n');
    expect(await new ContainerRestarter(s.path).restart('lnd')).toEqual({ ok: false, message: 'this container is protected[31m from restarts' });
  });

  it('never sends anything that is not a container name', async () => {
    const s = await service(() => 'ok\n');
    const r = new ContainerRestarter(s.path);
    for (const name of ['', 'a b', 'web\nrestart db', '-rf', '../x', 'a'.repeat(200), 'web;id']) {
      expect((await r.restart(name)).ok).toBe(false);
    }
    expect(s.seen).toEqual([]);
  });

  it('is unavailable to an account the socket shuts out, or with no service', async () => {
    const s = await service(() => 'ok\n', 0o000);
    const r = new ContainerRestarter(s.path);
    // root ignores file modes: this part of the check only means something for a normal user
    if (process.getuid?.() !== 0) {
      expect(await r.available()).toBe(false);
      expect(await r.restart('web')).toEqual({ ok: false, message: 'This account may not restart containers' });
    }
    const missing = new ContainerRestarter(join(temp(), 'none.sock'));
    expect(await missing.available()).toBe(false);
    expect(await missing.restart('web')).toEqual({ ok: false, message: 'The restart service is not running' });
    const file = join(temp(), 'plain'); writeFileSync(file, '');
    expect(await new ContainerRestarter(file).available()).toBe(false);
    expect(() => new ContainerRestarter('relative.sock')).toThrow();
  });

  it('gives up on a silent service, refuses a second restart meanwhile, and survives garbage', async () => {
    const silent = await service(() => null);
    const r = new ContainerRestarter(silent.path, 80);
    const first = r.restart('web');
    expect(await r.restart('db')).toEqual({ ok: false, message: 'Another restart is still running' });
    expect(await first).toEqual({ ok: false, message: 'The restart service did not answer in time' });
    const odd = await service(() => 'x'.repeat(5000));
    expect(await new ContainerRestarter(odd.path).restart('web')).toEqual({ ok: false, message: 'The restart service gave no answer' });
    const hangup = await service(() => '');
    expect(await new ContainerRestarter(hangup.path).restart('web')).toEqual({ ok: false, message: 'The restart service gave no answer' });
  });
});

describe('status file: Restartable', () => {
  const entry = (over: Record<string, unknown>) => parseEntry({ Id: 'a'.repeat(64), Names: ['/web'], State: 'running', Status: 'Up', ...over });
  it('is true unless the file says false', () => {
    expect(entry({})!.restartable).toBe(true);
    expect(entry({ Restartable: 'false' })!.restartable).toBe(true);
    expect(entry({ Restartable: false })!.restartable).toBe(false);
  });
});

/** The example service script, run with a fake `docker` first on PATH. */
describe('example restart service script', () => {
  const script = join(__dirname, '..', 'docs', 'examples', 'container-restart', 'sofa-container-restart');
  function run(request: string) {
    const dir = temp();
    const log = join(dir, 'calls');
    const id = (c: string) => c.repeat(64);
    writeFileSync(join(dir, 'docker'), `#!/bin/bash
echo "$*" >> ${JSON.stringify(log)}
case "$1 \${!#}" in
  "inspect web") echo "${id('a')}|/web|true|" ;;
  "inspect lnd") echo "${id('b')}|/lnd|true|false" ;;
  "inspect typo") echo "${id('c')}|/typo|true| False " ;;
  "inspect off") echo "${id('d')}|/off|true|no" ;;
  "inspect abc") echo "${id('e')}|/abcdef|true|" ;;
  "inspect broken") echo "${id('f')}|/broken|true|" ;;
  "inspect stopped") echo "${id('1')}|/stopped|false|" ;;
  "inspect slow") echo "${id('2')}|/slow|true|" ;;
  "restart ${id('a')}") exit 0 ;;
  "restart ${id('2')}") exit 124 ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(dir, 'timeout'), '#!/bin/bash\nshift\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'logger'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const out = spawnSync('bash', [script], { input: request, encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH}`, LANG: 'en_GB.UTF-8' }, timeout: 20_000 });
    let calls = '';
    try { calls = require('node:fs').readFileSync(log, 'utf8'); } catch { /* docker never called */ }
    return { reply: out.stdout, calls };
  }

  it('restarts a named container', () => {
    const r = run('restart web\n');
    expect(r.reply).toBe('ok\n');
    expect(r.calls.trim().split('\n').at(-1)).toBe(`restart -- ${'a'.repeat(64)}`);
  });

  it('refuses a protected container (however the label is spelt), an id prefix, an unknown or stopped one', () => {
    for (const name of ['lnd', 'typo', 'off']) {
      const r = run(`restart ${name}\n`);
      expect(r.reply).toBe('error this container is protected from restarts\n');
      expect(r.calls).not.toMatch(/^restart/m);
    }
    expect(run('restart abc\n').reply).toBe('error there is no such container\n');
    expect(run('restart nope\n').reply).toBe('error there is no such container\n');
    expect(run('restart stopped\n')).toMatchObject({ reply: 'error this container is not running\n' });
    expect(run('restart stopped\n').calls).not.toMatch(/^restart/m);
  });

  it('says so when Docker fails or is slow', () => {
    expect(run('restart broken\n').reply).toBe('error Docker could not restart it\n');
    expect(run('restart slow\n').reply).toBe('error Docker is taking a long time: it may still be restarting\n');
  });

  it.each(['stop web\n', 'restart\n', 'restart web db\n', 'restart -f\n', 'restart web;id\n', 'restart $(id)\n', 'rm web\n', '\n', 'restart wéb\n', 'restart ｗeb\n', 'restart web\r\n', 'restart web'.padEnd(400, 'x') + '\n'])(
    'never calls docker for %j', (request) => {
      const r = run(request);
      expect(r.reply).toBe('error bad request\n');
      expect(r.calls).toBe('');
    });
});
