import { describe, expect, it } from 'vitest';
import {
  classify, countParts, displayImage, exitCode, groupContainers, groupNames, healthFromStatus, iconFor, imageRepository,
  MAX_ENTRIES, monogram, OTHER_GROUP, packGroups, parseEntry, parseStatusFile, shortName, sortContainers, statusLine,
  summaryColour, type ContainerInfo,
} from '../src/shared/containers';
import { demoStatusEntries } from '../src/main/containers-demo';
import { parseConfig, ConfigError } from '../src/main/config';

const ID = 'a'.repeat(64);
const entry = (over: Record<string, unknown> = {}) => ({
  Id: ID, Names: ['/web'], Image: 'nginx:1.27', State: 'running', Status: 'Up 2 hours', ...over,
});
const info = (name: string, colour: ContainerInfo['colour'], project = '', service = '', image = 'x:1'): ContainerInfo =>
  ({ id: name.padEnd(12, '0').slice(0, 12), name, image, state: 'running', status: '', project, service, colour, word: '', line: '' });

describe('container status: red / amber / green / grey', () => {
  it.each([
    ['running', 'Up 2 hours', undefined, 'green', 'running'],
    ['running', 'Up 2 hours (healthy)', undefined, 'green', 'healthy'],
    ['running', 'Up 2 hours', 'healthy', 'green', 'healthy'],
    ['running', 'Up 2 hours (unhealthy)', undefined, 'red', 'unhealthy'],
    ['running', 'Up 28 hours (unhealthy)', 'unhealthy', 'red', 'unhealthy'],
    ['running', 'Up 5 seconds (health: starting)', undefined, 'amber', 'starting'],
    ['running', 'Up 5 seconds', 'starting', 'amber', 'starting'],
    ['restarting', 'Restarting (1) 8 seconds ago', undefined, 'amber', 'restarting'],
    ['paused', 'Up 3 days (Paused)', undefined, 'amber', 'paused'],
    ['created', 'Created', undefined, 'amber', 'created'],
    ['exited', 'Exited (0) 9 days ago', undefined, 'grey', 'stopped'],
    ['exited', 'Exited (137) 36 hours ago', undefined, 'grey', 'stopped'],
    ['exited', 'Exited (143) 36 hours ago', 'unhealthy', 'grey', 'stopped'],
    ['exited', 'Exited (1) 3 hours ago', undefined, 'red', 'failed'],
    ['exited', 'Exited (2) 3 hours ago', 'none', 'red', 'failed'],
    ['exited', 'Exited', undefined, 'amber', 'exited'],
    ['dead', 'Dead', undefined, 'red', 'dead'],
    ['unknown', '', undefined, 'amber', 'unknown'],
  ])('%s "%s" (health %s) → %s %s', (state, status, health, colour, word) => {
    expect(classify(state, status, health)).toEqual({ colour, word });
  });

  it('prefers Health.Status over the Status text, and falls back to the text for "none"', () => {
    expect(classify('running', 'Up 1 hour (healthy)', 'unhealthy').colour).toBe('red');
    expect(classify('running', 'Up 1 hour (unhealthy)', 'none').colour).toBe('red');
  });

  it('parses exit codes and health text', () => {
    expect(exitCode('Exited (137) 36 hours ago')).toBe(137);
    expect(exitCode('Exited (0) About a minute ago')).toBe(0);
    expect(exitCode('Up 2 hours')).toBeNull();
    expect(healthFromStatus('Up 2 hours (health: starting)')).toBe('starting');
    expect(healthFromStatus('Up 2 hours (unhealthy)')).toBe('unhealthy');
    expect(healthFromStatus('Up 2 hours (healthy)')).toBe('healthy');
    expect(healthFromStatus('Up 2 hours')).toBeNull();
  });

  it('tidies the short status line', () => {
    expect(statusLine('Up 2 hours (healthy)')).toBe('Up 2 hours');
    expect(statusLine('Up About an hour (health: starting)')).toBe('Up about an hour');
    expect(statusLine('Exited (137) 36 hours ago')).toBe('36 hours ago');
    expect(statusLine('Up 3 days (Paused)')).toBe('Up 3 days');
    expect(statusLine('Created')).toBe('Created');
  });
});

describe('status file validation', () => {
  it('keeps the fields the view needs, from the real file shape', () => {
    const c = parseEntry(entry({
      Names: ['/alerts-docker-proxy'], Image: 'tecnativa/docker-socket-proxy:v0.5.0@sha256:' + 'b'.repeat(64),
      Status: 'Up 28 hours (unhealthy)', Health: { Status: 'unhealthy' }, Project: 'Alerts', Service: 'docker-proxy', Extra: { x: 1 },
    }));
    expect(c).toEqual({
      id: 'aaaaaaaaaaaa', name: 'alerts-docker-proxy', image: 'tecnativa/docker-socket-proxy:v0.5.0', state: 'running',
      status: 'Up 28 hours (unhealthy)', project: 'alerts', service: 'docker-proxy', colour: 'red', word: 'unhealthy', line: 'Up 28 hours',
    });
  });

  it('works without Project, Service or Health', () => {
    expect(parseEntry(entry())).toMatchObject({ project: '', service: '', colour: 'green', word: 'running' });
  });

  it.each([
    ['no id', { Id: undefined }], ['short id', { Id: 'abc' }], ['uppercase id', { Id: 'A'.repeat(64) }],
    ['no names', { Names: [] }], ['names not a list', { Names: '/web' }], ['bad name', { Names: ['/../etc'] }],
    ['long name', { Names: ['/' + 'a'.repeat(200)] }], ['no state', { State: 3 }],
  ])('rejects an entry with %s', (_label, over) => {
    expect(parseEntry(entry(over))).toBeNull();
  });

  it('drops invalid optional fields and strips control characters', () => {
    const c = parseEntry(entry({ Status: 'Up\u0007 2 hours‮', Health: { Status: 'evil' }, Project: 42, Service: ['x'], Image: 7 }))!;
    expect(c.status).toBe('Up 2 hours');
    expect(c.project).toBe('');
    expect(c.service).toBe('');
    expect(c.image).toBe('');
    expect(parseEntry(entry({ Status: 'x'.repeat(5000) }))!.status).toHaveLength(200);
    expect(parseEntry(entry({ State: 'weird' }))!.word).toBe('unknown');
  });

  it('caps the number of entries and counts what it skipped', () => {
    const many = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => entry({ Names: [`/c${i}`] }));
    const { containers, skipped } = parseStatusFile([...many.slice(0, 3), null, 'x', ...many.slice(3)]);
    expect(containers).toHaveLength(MAX_ENTRIES - 2);
    expect(skipped).toBe(22 + 2);
    expect(() => parseStatusFile({ containers: [] })).toThrow();
  });

  it('accepts every demo entry', () => {
    const demo = demoStatusEntries();
    const { containers, skipped } = parseStatusFile(demo);
    expect(skipped).toBe(0);
    expect(containers.length).toBeGreaterThanOrEqual(50);
    expect(new Set(containers.map((c) => c.word))).toEqual(new Set(['healthy', 'running', 'unhealthy', 'starting', 'restarting', 'paused', 'created', 'stopped', 'failed', 'dead']));
    expect(containers.some((c) => !c.project)).toBe(true);
  });
});

describe('image names', () => {
  it.each([
    ['tecnativa/docker-socket-proxy:v0.5.0@sha256:' + 'c'.repeat(64), 'tecnativa/docker-socket-proxy:v0.5.0', 'docker-socket-proxy'],
    ['ghcr.io/open-webui/open-webui:main', 'open-webui/open-webui:main', 'open-webui'],
    ['lscr.io/linuxserver/sonarr:latest', 'linuxserver/sonarr:latest', 'sonarr'],
    ['localhost:5000/team/app:1', 'team/app:1', 'app'],
    ['docker.io/library/postgres:16', 'postgres:16', 'postgres'],
    ['redis', 'redis', 'redis'],
    ['sha256:' + 'd'.repeat(64), 'dddddddddddd', 'dddddddddddd'],
  ])('%s', (image, display, repo) => {
    expect(displayImage(image)).toBe(display);
    expect(imageRepository(image)).toBe(repo);
  });
});

describe('sorting and grouping', () => {
  it('sorts problems first, then by project and name', () => {
    const sorted = sortContainers([info('b', 'green', 'p'), info('a', 'grey'), info('z', 'red', 'q'), info('c', 'amber'), info('a', 'green', 'p'), info('y', 'red', 'a')]);
    expect(sorted.map((c) => `${c.colour}:${c.project}:${c.name}`)).toEqual(['red:a:y', 'red:q:z', 'amber::c', 'green:p:a', 'green:p:b', 'grey::a']);
  });

  it('folds projects sharing a first word with another project (t3-*), and nothing else', () => {
    const names = groupNames(['t3-stack', 't3-studio-relay', 't3-lounge-relay', 't3-laptop-relay', 't3-office-relay', 'nextcloud', 'home', 'open-webui', '']);
    expect(names.get('t3-stack')).toBe('t3');
    expect(names.get('t3-office-relay')).toBe('t3');
    expect(names.get('open-webui')).toBe('open-webui');
    expect(names.get('home')).toBe('home');
    expect(names.has('')).toBe(false);
  });

  it('groups the demo data without merging unrelated stacks', () => {
    const { containers } = parseStatusFile(demoStatusEntries());
    const groups = groupContainers(containers);
    const of = (name: string) => groups.find((g) => g.containers.some((c) => c.name === name))!.name;
    expect(of('t3-lounge-relay')).toBe('t3');
    expect(of('t3-web')).toBe('t3');
    expect(of('photos-immich-ml-1')).toBe('photos'); // photos-relay and photos-immich share their first word
    expect(of('open-webui')).toBe('open-webui');
    expect(of('homeassistant')).toBe('home');
    expect(of('scratch-postgres')).toBe(OTHER_GROUP);
    // Every group's members come from projects with that name or that first word.
    for (const g of groups) for (const c of g.containers) {
      expect(g.name === OTHER_GROUP ? c.project === '' : c.project === g.name || c.project.startsWith(`${g.name}-`)).toBe(true);
    }
  });

  it('orders groups by worst colour, Other after named groups of the same colour', () => {
    const groups = groupContainers([info('a', 'green', 'zeta'), info('b', 'red'), info('c', 'red', 'beta'), info('d', 'green', 'alpha'), info('e', 'grey', 'aaa')]);
    expect(groups.map((g) => `${g.colour}:${g.name}`)).toEqual(['red:beta', `red:${OTHER_GROUP}`, 'green:alpha', 'green:zeta', 'grey:aaa']);
  });

  it('packs small groups into shared rows, never mixing colours', () => {
    const group = (name: string, n: number, colour: ContainerInfo['colour']) => ({ name, colour, containers: Array.from({ length: n }, (_, i) => info(`${name}${i}`, colour)) });
    const rows = packGroups([group('a', 3, 'red'), group('b', 3, 'red'), group('c', 2, 'red'), group('d', 7, 'green'), group('e', 1, 'green'), group('f', 4, 'green')], 5);
    expect(rows.map((r) => r.map((g) => g.name).join('+'))).toEqual(['a+c', 'b', 'd', 'e+f']);
  });

  it('summarises for the tile and the header', () => {
    expect(summaryColour([])).toBeUndefined();
    expect(summaryColour([info('a', 'green'), info('b', 'grey')])).toBe('green');
    expect(summaryColour([info('a', 'green'), info('b', 'amber')])).toBe('amber');
    expect(summaryColour([info('a', 'amber'), info('b', 'red')])).toBe('red');
    expect(countParts([info('a', 'green'), info('b', 'green'), info('c', 'red'), info('d', 'grey')]).map((p) => p.text))
      .toEqual(['1 problem', '2 running', '1 stopped']);
  });

  it('shortens names inside their stack', () => {
    expect(shortName('nextcloud-db', 'nextcloud')).toBe('db');
    expect(shortName('t3-lounge-relay', 't3')).toBe('lounge-relay');
    expect(shortName('open-webui', 'open-webui')).toBe('open-webui');
    expect(shortName('homeassistant', 'home')).toBe('homeassistant');
  });
});

describe('icons', () => {
  const available = new Set(['nextcloud', 'redis', 'mariadb', 'postgres', 'home-assistant', 'bitcoin', 'crowdsec', 'nginx-proxy-manager', 'mosquitto', 'docker', 'nginx', 'watchtower', 'open-webui']);
  const icon = (name: string, service = '', image = 'example/x:1') => iconFor({ name, service, image }, available);

  it('tries the service, then the container name, then the image repository', () => {
    expect(icon('anything', 'redis', 'nextcloud:31')).toBe('redis');
    expect(icon('nextcloud-db', 'db', 'mariadb:11.4')).toBe('mariadb');
    expect(icon('nextcloud-app', 'app', 'nextcloud:31-apache')).toBe('nextcloud');
    expect(icon('open-webui', '', 'ghcr.io/open-webui/open-webui:main')).toBe('open-webui');
  });

  it('uses aliases', () => {
    expect(icon('homeassistant')).toBe('home-assistant');
    expect(icon('bitcoind')).toBe('bitcoin');
    expect(icon('db', '', 'postgresql:16')).toBe('postgres');
    expect(icon('broker', '', 'eclipse-mosquitto:2')).toBe('mosquitto');
    expect(icon('alerts-docker-proxy', 'docker-proxy', 'tecnativa/docker-socket-proxy:v0.5.0@sha256:' + 'e'.repeat(64))).toBe('docker');
  });

  it('falls back to the first word of a name', () => {
    expect(icon('crowdsec-firewall-bouncer')).toBe('crowdsec');
    expect(icon('npm-backup-helper', '', 'alpine:3')).toBe('nginx-proxy-manager');
    expect(icon('watchtower-exposed')).toBe('watchtower');
  });

  it('returns null for a monogram, with stable letters and colour', () => {
    expect(icon('turbo-whisper')).toBeNull();
    expect(monogram('turbo-whisper').letters).toBe('TW');
    expect(monogram('tika').letters).toBe('Ti');
    expect(monogram('gini3d').letters).toBe('Gi');
    expect(monogram('lnd').hue).toBe(monogram('lnd').hue);
    expect(monogram('lnd').hue).not.toBe(monogram('electrs').hue);
  });
});

describe('[containers] config', () => {
  it('reads an absolute status file path', () => {
    expect(parseConfig('[containers]\nfile = "/var/lib/docker-status/containers.json"').containersFile).toBe('/var/lib/docker-status/containers.json');
    expect(parseConfig('').containersFile).toBeUndefined();
  });

  it.each([
    'file = "containers.json"', 'file = "~/containers.json"', 'file = "/var/lib/../etc/shadow"', 'file = "/var/./x.json"',
    'file = ""', 'url = "http://127.0.0.1:2375"', 'socket = "/var/run/docker.sock"', 'file = "/x.json"\nurl = "http://127.0.0.1"',
  ])('rejects %s', (body) => {
    expect(() => parseConfig(`[containers]\n${body}`)).toThrow(ConfigError);
  });

  it('offers a Docker tile from the catalogue', () => {
    const c = parseConfig('[[apps]]\nid = "docker"\ncatalogue = "docker"');
    expect(c.apps[0]).toMatchObject({ id: 'docker', name: 'Docker', type: 'containers', brand: 'docker' });
    expect(c.apps[0]?.group).toBeUndefined();
  });
});
