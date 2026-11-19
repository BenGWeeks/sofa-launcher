import { createHash } from 'node:crypto';
import { parseConfig, type Config } from './config';
import type { StatusFileReader } from './containers-status';
import type { ContainerHistory } from './containers-history';
import { HISTORY_BUCKETS, HISTORY_BUCKET_MS, type ContainerInfo } from '@shared/containers';

/** Where the demo pretends the status file is (never read: demo mode injects a reader). */
export const DEMO_CONTAINERS_FILE = '/var/lib/docker-status/containers.json';

type Row = [name: string, project: string, service: string, image: string, state: string, status: string, health?: string];

const up = (h: string, health?: string) => `Up ${h}${health ? ` (${health === 'starting' ? 'health: starting' : health})` : ''}`;
const H = 'healthy';

/**
 * About 55 fictional containers in realistic stacks, covering every state: running (with and
 * without health checks), unhealthy, starting, restarting, paused, created, exited 0 / 137 / 143
 * (stopped), exited 1 / 2 (failed) and dead. Some carry health only in the Status text.
 */
const ROWS: Row[] = [
  ['t3-web', 't3-stack', 'web', 'ghcr.io/example/t3-web:1.4.2', 'running', up('3 days', H), H],
  ['t3-worker', 't3-stack', 'worker', 'ghcr.io/example/t3-worker:1.4.2', 'running', up('3 days')],
  ['t3-redis', 't3-stack', 'redis', 'redis:7-alpine', 'running', up('3 days', H), H],
  ['t3-studio-relay', 't3-studio-relay', 'relay', 'ghcr.io/example/t3-relay:0.9.0', 'running', up('2 days')],
  ['t3-lounge-relay', 't3-lounge-relay', 'relay', 'ghcr.io/example/t3-relay:0.9.0', 'running', up('2 days')],
  ['t3-laptop-relay', 't3-laptop-relay', 'relay', 'ghcr.io/example/t3-relay:0.9.0', 'running', up('2 days')],
  ['t3-office-relay', 't3-office-relay', 'relay', 'ghcr.io/example/t3-relay:0.9.0', 'running', up('5 hours')],
  ['photos-relay', 'photos-relay', 'relay', 'ghcr.io/example/photos-relay:2.1.0', 'running', up('6 days', H), H],
  ['photos-immich-server-1', 'photos-immich', 'server', 'ghcr.io/immich-app/immich-server:v2.2.0', 'running', up('6 days', H), H],
  ['photos-immich-ml-1', 'photos-immich', 'machine-learning', 'ghcr.io/immich-app/immich-machine-learning:v2.2.0', 'running', up('6 days', 'unhealthy'), 'unhealthy'],
  ['photos-immich-db-1', 'photos-immich', 'database', 'ghcr.io/immich-app/postgres:16-vectorchord', 'running', up('6 days', H), H],
  ['open-webui', 'open-webui', 'open-webui', 'ghcr.io/open-webui/open-webui:main', 'running', up('28 hours', H), H],
  ['ollama', 'open-webui', 'ollama', 'ollama/ollama:0.12.3', 'running', up('28 hours')],
  ['searxng', 'open-webui', 'searxng', 'searxng/searxng:latest', 'running', up('28 hours')],
  ['nginx-proxy-manager', 'npm', 'app', 'jc21/nginx-proxy-manager:2.12.6', 'running', up('9 days', H), H],
  ['npm-backup-helper', 'npm', 'backup', 'alpine:3.22', 'exited', 'Exited (0) 9 days ago'],
  ['paperless-web', 'paperless', 'webserver', 'ghcr.io/paperless-ngx/paperless-ngx:2.18.4', 'running', up('4 days', H), H],
  ['paperless-broker', 'paperless', 'broker', 'redis:7-alpine', 'restarting', 'Restarting (1) 8 seconds ago'],
  ['paperless-db', 'paperless', 'db', 'postgres:16-alpine', 'running', up('4 days', H), H],
  ['wyoming-whisper', 'wyoming', 'whisper', 'rhasspy/wyoming-whisper:2.5.0', 'running', up('8 days')],
  ['wyoming-piper', 'wyoming', 'piper', 'rhasspy/wyoming-piper:1.6.2', 'running', up('40 seconds', 'starting'), 'starting'],
  ['nextcloud-app', 'nextcloud', 'app', 'nextcloud:31-apache', 'running', up('7 days', H), H],
  ['nextcloud-cron', 'nextcloud', 'cron', 'nextcloud:31-apache', 'running', up('7 days')],
  ['nextcloud-db', 'nextcloud', 'db', 'mariadb:11.4', 'running', up('7 days', H), H],
  ['nextcloud-redis', 'nextcloud', 'redis', 'redis:7-alpine', 'running', up('7 days', H), H],
  ['nextcloud-imaginary', 'nextcloud', 'imaginary', 'nextcloud/aio-imaginary:latest', 'dead', 'Dead'],
  ['gluetun', 'media', 'gluetun', 'qmcgaw/gluetun:v3.40.0', 'running', up('3 days', H), H],
  ['transmission', 'media', 'transmission', 'lscr.io/linuxserver/transmission:4.0.6', 'running', up('3 days')],
  ['jellyfin', 'media', 'jellyfin', 'jellyfin/jellyfin:10.11.0', 'running', up('3 days', H), H],
  ['jellyseerr', 'media', 'jellyseerr', 'fallenbagel/jellyseerr:2.7.3', 'running', up('3 days')],
  ['sonarr', 'media', 'sonarr', 'lscr.io/linuxserver/sonarr:4.0.15', 'running', up('3 days')],
  ['radarr', 'media', 'radarr', 'lscr.io/linuxserver/radarr:5.27.5', 'running', up('3 days')],
  ['prowlarr', 'media', 'prowlarr', 'lscr.io/linuxserver/prowlarr:2.0.5', 'running', up('3 days')],
  ['bazarr', 'media', 'bazarr', 'lscr.io/linuxserver/bazarr:1.5.3', 'running', up('3 days')],
  ['lidarr', 'media', 'lidarr', 'lscr.io/linuxserver/lidarr:2.13.3', 'paused', up('3 days') + ' (Paused)'],
  ['readarr', 'media', 'readarr', 'lscr.io/linuxserver/readarr:0.4.18-develop', 'exited', 'Exited (137) 2 days ago'],
  ['homeassistant', 'home', 'homeassistant', 'ghcr.io/home-assistant/home-assistant:2026.11.1', 'running', up('2 hours', H), H],
  ['frigate', 'home', 'frigate', 'ghcr.io/blakeblackshear/frigate:0.16.2', 'running', up('2 hours', H), H],
  ['mosquitto', 'home', 'mosquitto', 'eclipse-mosquitto:2.0.22', 'running', up('2 hours')],
  ['zigbee2mqtt', 'home', 'zigbee2mqtt', 'koenkk/zigbee2mqtt:2.6.2', 'running', up('2 hours')],
  ['go2rtc', 'home', 'go2rtc', 'alexxit/go2rtc:1.9.10', 'running', up('2 hours')],
  ['esphome', 'home', 'esphome', 'ghcr.io/esphome/esphome:2025.10.3', 'running', up('2 hours', H), H],
  ['node-red', 'home', 'node-red', 'nodered/node-red:4.1.0', 'running', up('2 hours')],
  ['uptime-kuma', 'monitoring', 'uptime-kuma', 'louislam/uptime-kuma:2.0.1', 'running', up('11 days', H), H],
  ['grafana', 'monitoring', 'grafana', 'grafana/grafana:12.2.0', 'running', up('11 days', H), H],
  ['prometheus', 'monitoring', 'prometheus', 'prom/prometheus:v3.6.0', 'running', up('11 days')],
  ['node-exporter', 'monitoring', 'node-exporter', 'prom/node-exporter:v1.9.1', 'running', up('11 days')],
  ['pihole', 'pihole', 'pihole', 'pihole/pihole:2025.10.0', 'running', up('20 days', H), H],
  ['wireguard', 'wireguard', 'wireguard', 'lscr.io/linuxserver/wireguard:1.0.20250521', 'running', up('20 days')],
  ['vaultwarden', 'vaultwarden', 'vaultwarden', 'vaultwarden/server:1.34.3', 'running', up('20 days', H), H],
  ['watchtower', 'watchtower', 'watchtower', 'containrrr/watchtower:1.7.1', 'running', up('20 days', H), H],
  ['syncthing', 'sync', 'syncthing', 'syncthing/syncthing:2.0.10', 'exited', 'Exited (143) 36 hours ago', 'unhealthy'],
  ['sync-backup', 'sync', 'backup', 'ghcr.io/example/sync-backup:1.0.0', 'exited', 'Exited (2) 3 hours ago'],
  ['scratch-postgres', '', '', 'postgres:17', 'exited', 'Exited (1) 20 minutes ago'],
  ['redis-test', '', '', 'redis:8', 'created', 'Created'],
  ['paused-job', '', '', 'python:3.13-slim', 'paused', up('6 hours') + ' (Paused)'],
];

/** What a few of the demo services are for (as a compose label or the image's own label would say). */
const DESCRIPTIONS: Record<string, string> = {
  jellyfin: 'Streams the film, TV and music library to every screen in the house.',
  jellyseerr: 'Lets the family request films and series for the media library.',
  sonarr: 'Finds new TV episodes and files them in the library.',
  radarr: 'Finds films and files them in the library.',
  homeassistant: 'Runs the home: lights, heating, sensors and automations.',
  frigate: 'Records the cameras and spots people, cars and animals.',
  mosquitto: 'Message broker the smart-home devices talk through.',
  pihole: 'Blocks adverts and trackers for the whole network.',
  vaultwarden: 'The family password manager.',
  'uptime-kuma': 'Checks that services answer and raises the alarm when they stop.',
  grafana: 'Dashboards for the server’s metrics.',
  'machine-learning': 'Recognises faces and objects in the photo library.',
  server: 'The photo library’s web and mobile back end.',
  webserver: 'Scans, files and searches the household paperwork.',
  whisper: 'Turns speech into text for the voice assistant.',
  piper: 'Speaks the voice assistant’s replies.',
};

/** A made-up registry check: about one container in five has something newer. */
function demoUpdate(name: string, image: string): Record<string, unknown> {
  const h = createHash('sha256').update(`update:${name}`).digest();
  const tag = image.split(':').pop() ?? '';
  const Checked = '2026-11-19T06:30:00Z';
  if (image.includes('example/')) return { Available: null, Current: tag, Latest: '', Kind: 'local', Checked };
  const numbered = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  if (!numbered) return { Available: h[0]! % 4 === 0, Current: h.toString('hex').slice(0, 12), Latest: h.toString('hex').slice(12, 24), Kind: 'floating', Checked };
  const newer = h[0]! % 5 === 0 || name === 'paperless-web';
  const next = tag.replace(/^(v?\d+\.\d+\.)(\d+)/, (_m, a: string, b: string) => `${a}${Number(b) + 1}`);
  return { Available: newer, Current: tag, Latest: newer ? next : tag, Kind: 'pinned', Checked };
}

/** A steady, made-up load for a demo container: the same every run. */
function demoLoad(name: string): { cpu: number; mem: number } {
  const h = createHash('sha256').update(`load:${name}`).digest();
  return { cpu: Math.round((0.2 + (h[0]! / 255) ** 3 * 60) * 10) / 10, mem: Math.round((40 + (h[1]! / 255) ** 2 * 1900) * 1024 * 1024) };
}

/**
 * A day of made-up history for the screenshots: steady containers, a daily rhythm in the load,
 * and an outage or two for the ones that are in trouble now.
 */
export function fillDemoHistory(history: ContainerHistory, containers: ContainerInfo[], now: number): void {
  for (let i = HISTORY_BUCKETS - 1; i >= 0; i--) {
    const t = now - i * HISTORY_BUCKET_MS;
    const wave = 1 + 0.5 * Math.sin((HISTORY_BUCKETS - i) / 11);
    history.record(containers.map((c) => {
      const h = createHash('sha256').update(`history:${c.name}`).digest();
      const start = 20 + (h[2]! % 90);
      const wasFine = c.colour !== 'green' && i > (c.colour === 'grey' ? start : 6 + (h[3]! % 30));
      const blip = c.colour === 'green' && h[4]! % 5 === 0 && i >= start && i < start + 2;
      const jitter = 0.8 + ((h[(i % 20) + 5]! / 255) * 0.5);
      const base = demoLoad(c.name);
      const running = wasFine || c.colour === 'green';
      return {
        ...c,
        colour: blip ? 'amber' as const : wasFine ? 'green' as const : c.colour,
        cpu: running && !blip ? Math.round(base.cpu * wave * jitter * 10) / 10 : c.colour === 'red' && c.state === 'running' ? base.cpu * 2.5 * jitter : null,
        mem: running && !blip ? Math.round(base.mem * (0.85 + 0.15 * wave)) : c.state === 'running' ? base.mem : null,
      };
    }), t);
  }
}

const digest = (name: string) => createHash('sha256').update(`demo:${name}`).digest('hex');

/** The rows in the status file's shape (sorted by name, as the real writer does). */
export function demoStatusEntries(): unknown[] {
  return ROWS.map(([name, project, service, image, state, status, health]) => ({
    Id: digest(name),
    Names: [`/${name}`],
    Image: `${image}@sha256:${digest(image)}`,
    State: state,
    Status: status,
    // Some demo containers publish health only in the Status text (the parser's fallback).
    ...(health ? { Health: { Status: health } } : status.includes('(healthy)') ? {} : { Health: { Status: 'none' } }),
    Project: project,
    Service: service,
    ...(DESCRIPTIONS[service] ? { Description: DESCRIPTIONS[service] } : {}),
    ...(state === 'running' ? { Update: demoUpdate(name, image) } : {}),
    ...(state === 'running' || state === 'paused' ? { Cpu: demoLoad(name).cpu, Mem: demoLoad(name).mem } : {}),
  })).sort((a, b) => a.Names[0]!.localeCompare(b.Names[0]!));
}

/**
 * A reader serving the demo file. "error": the first read succeeds with a file four minutes old,
 * every later read fails, so the view shows last good data, stale and unreadable.
 */
export function demoStatusReader(mode: 'ok' | 'error'): StatusFileReader {
  let reads = 0;
  const bytes = new TextEncoder().encode(JSON.stringify(demoStatusEntries()));
  return async () => {
    reads++;
    if (mode === 'error' && reads > 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { bytes, mtimeMs: Date.now() - (mode === 'error' ? 4 * 60_000 : 8_000) };
  };
}

/** The screenshot config plus a Docker tile and a [containers] table. */
export function withDemoDocker(config: Config): Config {
  const docker = parseConfig(`[[apps]]\nid = "docker"\ncatalogue = "docker"\n\n[containers]\nfile = "${DEMO_CONTAINERS_FILE}"\n`);
  return {
    ...config,
    apps: [...config.apps, ...docker.apps],
    configuredApps: [...config.configuredApps, ...docker.configuredApps],
    usedCatalogue: [...config.usedCatalogue, ...docker.usedCatalogue],
    containersFile: docker.containersFile,
  };
}
