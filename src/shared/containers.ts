/**
 * The Docker containers view: a pure model of the status file (validation, red/amber/green
 * status, stack grouping, icon matching). Shared by the main process (which reads and
 * validates the file) and the renderer (which draws it). No I/O here.
 */

export type ContainerColour = 'red' | 'amber' | 'green' | 'grey';

/** One container, validated and reduced to what the view shows. */
export interface ContainerInfo {
  /** First 12 hex digits of the container id. */
  id: string;
  name: string;
  /** Image reference without registry prefix or digest, e.g. "linuxserver/sonarr:latest". */
  image: string;
  state: string;
  /** The Engine's Status text, untouched apart from length/character limits ("Up 2 hours (healthy)"). */
  status: string;
  /** Compose project and service; empty when not started by compose (or not published). */
  project: string;
  service: string;
  colour: ContainerColour;
  /** The status in one word, so colour is never the only signal ("healthy", "stopped"...). */
  word: string;
  /** A short status line for the card ("Up 2 hours", "Exited 36 hours ago"). */
  line: string;
}

export interface ContainersSnapshot {
  /** Is a [containers] status file configured? */
  configured: boolean;
  containers: ContainerInfo[];
  /** Modification time (epoch ms) of the file the containers came from; null before the first good read. */
  modifiedAt: number | null;
  /** When the file was last read successfully (epoch ms). */
  readAt: number | null;
  /** The last read failed: the containers shown are the last good data (if any). */
  error: string | null;
  /** The file is older than STALE_AFTER_MS: its writer may have stopped. */
  stale: boolean;
  /** Entries left out because the file had more than MAX_ENTRIES, or entries that failed validation. */
  skipped: number;
}

/** The API the preload exposes as window.sofaContainers. */
export interface ContainersApi {
  /** The latest snapshot; `fresh` re-reads the file now (opening the view). */
  snapshot(fresh?: boolean): Promise<ContainersSnapshot>;
  /** Main asks the home window to show the containers view (the Docker tile was opened). */
  onShow(cb: () => void): () => void;
}

export const MAX_ENTRIES = 500;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const STALE_AFTER_MS = 60_000;

const STATES = new Set(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']);
const HEALTH = new Set(['healthy', 'unhealthy', 'starting', 'none']);
/** `docker stop` / `compose down` end a container with 0, SIGKILL (137) or SIGTERM (143). */
const DELIBERATE_EXIT_CODES = new Set([0, 137, 143]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Printable text only (no control or bidi-override characters), trimmed and capped. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

/** "Exited (137) 36 hours ago" → 137; null if the text has no exit code. */
export function exitCode(status: string): number | null {
  const match = /^Exited \((-?\d{1,4})\)/i.exec(status);
  return match ? Number(match[1]) : null;
}

/** Health from the Status text: "Up 2 hours (healthy)", "(unhealthy)", "(health: starting)". */
export function healthFromStatus(status: string): 'healthy' | 'unhealthy' | 'starting' | null {
  if (/\(health: starting\)/i.test(status)) return 'starting';
  if (/\(unhealthy\)/i.test(status)) return 'unhealthy';
  if (/\(healthy\)/i.test(status)) return 'healthy';
  return null;
}

/** Colour and word for a container. Health.Status is preferred; the Status text is the fallback. */
export function classify(state: string, status: string, health?: string | null): { colour: ContainerColour; word: string } {
  switch (state) {
    case 'running': {
      const h = health && health !== 'none' ? health : healthFromStatus(status);
      if (h === 'unhealthy') return { colour: 'red', word: 'unhealthy' };
      if (h === 'starting') return { colour: 'amber', word: 'starting' };
      return { colour: 'green', word: h === 'healthy' ? 'healthy' : 'running' };
    }
    case 'exited': {
      const code = exitCode(status);
      if (code === null) return { colour: 'amber', word: 'exited' };
      return DELIBERATE_EXIT_CODES.has(code) ? { colour: 'grey', word: 'stopped' } : { colour: 'red', word: 'failed' };
    }
    case 'dead':
      return { colour: 'red', word: 'dead' };
    case 'restarting': case 'paused': case 'created': case 'removing':
      return { colour: 'amber', word: state };
    default:
      return { colour: 'amber', word: 'unknown' };
  }
}

/**
 * A short status line beside the word: health, "Paused" and "Exited (code)" are said by the
 * word already ("STOPPED 36 hours ago", "HEALTHY Up 2 hours"). The full text is in the details.
 */
export function statusLine(status: string): string {
  let line = status.replace(/\s*\((?:healthy|unhealthy|health: starting|paused)\)\s*$/i, '').replace(/^Exited \(-?\d+\)\s*/i, '');
  line = line.replace(/\b(About|Less than)\b/g, (w) => w.toLowerCase());
  return line.trim() || status;
}

/** "ghcr.io/open-webui/open-webui:main@sha256:…" → "open-webui/open-webui:main". */
export function displayImage(image: string): string {
  let ref = image.replace(/@sha256:[0-9a-f]*$/i, '');
  if (/^sha256:[0-9a-f]+$/i.test(ref)) return ref.slice(7, 19);
  const parts = ref.split('/');
  // A first part with a dot or colon, or "localhost", is a registry host.
  if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0]!)) parts.shift();
  ref = parts.join('/');
  if (ref.startsWith('library/')) ref = ref.slice(8);
  return ref;
}

/** The image's repository name: "lscr.io/linuxserver/sonarr:latest" → "sonarr". */
export function imageRepository(image: string): string {
  const ref = displayImage(image);
  const last = ref.split('/').pop() ?? '';
  return last.replace(/:[^:]*$/, '').toLowerCase();
}

/**
 * Validate one status-file entry. Returns null for entries without a usable id, name or
 * state; optional fields that fail validation are dropped. Unknown fields are ignored.
 */
export function parseEntry(raw: unknown): ContainerInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.Id === 'string' && /^[0-9a-f]{12,64}$/.test(r.Id) ? r.Id.slice(0, 12) : null;
  const first = Array.isArray(r.Names) ? r.Names[0] : null;
  const name = typeof first === 'string' ? first.replace(/^\//, '') : null;
  const state = typeof r.State === 'string' ? r.State.toLowerCase() : null;
  if (!id || !name || !NAME.test(name) || !state || state.length > 16) return null;
  const status = text(r.Status, 200) ?? '';
  const health = r.Health && typeof r.Health === 'object' && !Array.isArray(r.Health) ? (r.Health as Record<string, unknown>).Status : null;
  const healthStatus = typeof health === 'string' && HEALTH.has(health) ? health : null;
  const known = STATES.has(state) ? state : 'unknown';
  const { colour, word } = classify(known, status, healthStatus);
  return {
    id, name, state: known, status,
    image: displayImage(text(r.Image, 256) ?? ''),
    project: (text(r.Project, 64) ?? '').toLowerCase(),
    service: text(r.Service, 64) ?? '',
    colour, word, line: statusLine(status),
  };
}

/** Validate the whole file (a JSON array). Throws if it isn't an array. */
export function parseStatusFile(data: unknown): { containers: ContainerInfo[]; skipped: number } {
  if (!Array.isArray(data)) throw new Error('The status file is not a list of containers');
  const containers: ContainerInfo[] = [];
  let skipped = Math.max(0, data.length - MAX_ENTRIES);
  for (const raw of data.slice(0, MAX_ENTRIES)) {
    const info = parseEntry(raw);
    if (info) containers.push(info); else skipped++;
  }
  return { containers, skipped };
}

// ---- ordering and grouping --------------------------------------------------

export const COLOUR_ORDER: ContainerColour[] = ['red', 'amber', 'green', 'grey'];
const rank = (c: ContainerColour) => COLOUR_ORDER.indexOf(c);
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** Problems first (red, amber, green, grey); within a colour by project, then name. */
export function sortContainers(list: ContainerInfo[]): ContainerInfo[] {
  return [...list].sort((a, b) => rank(a.colour) - rank(b.colour) || byName(a.project, b.project) || byName(a.name, b.name));
}

export const OTHER_GROUP = 'Other';

/**
 * The heading each project goes under. Rule: projects that share their first
 * hyphen-separated word with at least one other project are grouped under that word
 * (t3-stack, t3-host-relay → "t3"); every other project is its own group; no project → "Other".
 */
export function groupNames(projects: string[]): Map<string, string> {
  const distinct = [...new Set(projects.filter(Boolean))];
  const firstWord = (p: string) => p.split('-')[0]!;
  const counts = new Map<string, number>();
  for (const p of distinct) counts.set(firstWord(p), (counts.get(firstWord(p)) ?? 0) + 1);
  return new Map(distinct.map((p) => [p, (counts.get(firstWord(p)) ?? 0) > 1 ? firstWord(p) : p]));
}

export interface ContainerGroup {
  name: string;
  /** The group's worst colour. */
  colour: ContainerColour;
  containers: ContainerInfo[];
}

/**
 * Groups (stacks) with their containers sorted problems-first. Groups are ordered by their
 * worst colour, then name, with "Other" after named groups of the same colour.
 */
export function groupContainers(list: ContainerInfo[]): ContainerGroup[] {
  const names = groupNames(list.map((c) => c.project));
  const groups = new Map<string, ContainerInfo[]>();
  for (const c of list) {
    const name = c.project ? names.get(c.project)! : OTHER_GROUP;
    groups.set(name, [...groups.get(name) ?? [], c]);
  }
  return [...groups].map(([name, items]) => {
    const containers = sortContainers(items);
    return { name, colour: containers[0]!.colour, containers };
  }).sort((a, b) => rank(a.colour) - rank(b.colour)
    || Number(a.name === OTHER_GROUP) - Number(b.name === OTHER_GROUP)
    || byName(a.name, b.name));
}

/** The tile's summary dot: red if any red, else amber if any amber, else green. None if empty. */
export function summaryColour(list: ContainerInfo[]): 'red' | 'amber' | 'green' | undefined {
  if (!list.length) return undefined;
  if (list.some((c) => c.colour === 'red')) return 'red';
  if (list.some((c) => c.colour === 'amber')) return 'amber';
  return 'green';
}

const COUNT_WORDS: Record<ContainerColour, [string, string]> = {
  red: ['problem', 'problems'], amber: ['not ready', 'not ready'], green: ['running', 'running'], grey: ['stopped', 'stopped'],
};

/** "77 running · 1 problem · 7 stopped" parts, problems first, zero counts left out. */
export function countParts(list: ContainerInfo[]): { colour: ContainerColour; text: string }[] {
  return COLOUR_ORDER.map((colour) => {
    const n = list.filter((c) => c.colour === colour).length;
    return { colour, n, text: `${n} ${COUNT_WORDS[colour][n === 1 ? 0 : 1]}` };
  }).filter((p) => p.n > 0).map(({ colour, text }) => ({ colour, text }));
}

// ---- icons ------------------------------------------------------------------

/** Container, service or image names that go by another icon's name. */
export const ICON_ALIASES: Record<string, string> = {
  homeassistant: 'home-assistant',
  bitcoind: 'bitcoin',
  'bitcoin-core': 'bitcoin',
  postgresql: 'postgres',
  pgvector: 'postgres',
  'eclipse-mosquitto': 'mosquitto',
  npm: 'nginx-proxy-manager',
  'docker-socket-proxy': 'docker',
  'openresty': 'nginx',
};

/**
 * The icon for a container, from the bundled `available` set. Tried in order: the compose
 * service, the container name, the image's repository name (each lower-cased, through the
 * alias table); then the first hyphen-separated word of each ("crowdsec-firewall-bouncer"
 * → crowdsec). Null means: draw a monogram.
 */
export function iconFor(c: Pick<ContainerInfo, 'name' | 'service' | 'image'>, available: ReadonlySet<string>): string | null {
  const candidates = [c.service, c.name, imageRepository(c.image)].map((s) => s.toLowerCase()).filter(Boolean);
  const hit = (s: string) => {
    const key = ICON_ALIASES[s] ?? s;
    return available.has(key) ? key : null;
  };
  for (const s of candidates) { const k = hit(s); if (k) return k; }
  for (const s of candidates) { const k = hit(s.split(/[-_.]/)[0]!); if (k) return k; }
  return null;
}

/** Monogram letters and hue for a container without an icon: "turbo-whisper" → "TW". */
export function monogram(name: string): { letters: string; hue: number } {
  const words = name.split(/[-_.]+/).filter((w) => /^[A-Za-z]/.test(w));
  const one = words[0] ?? name;
  const letters = words.length >= 2
    ? (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase()
    : one.charAt(0).toUpperCase() + one.charAt(1).toLowerCase();
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 11);
  return { letters, hue };
}

/** A card's name inside its stack: "nextcloud-db" under "nextcloud" → "db" (the full name is in the details). */
export function shortName(name: string, group: string): string {
  const prefix = `${group.toLowerCase()}-`;
  return name.toLowerCase().startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
}

/**
 * Lay groups out in rows of `cols` cards. Groups keep their order of colour (a row never mixes
 * worst colours); within a colour, each group goes into the first row with room for all of
 * it (first fit), so small stacks share rows. A group with more than `cols` cards has rows of its own.
 */
export function packGroups(groups: ContainerGroup[], cols: number): ContainerGroup[][] {
  const rows: { colour: ContainerColour; used: number; groups: ContainerGroup[] }[] = [];
  for (const group of groups) {
    const size = group.containers.length;
    const row = size < cols ? rows.find((r) => r.colour === group.colour && r.used + size <= cols) : undefined;
    if (row) { row.groups.push(group); row.used += size; }
    else rows.push({ colour: group.colour, used: Math.min(size, cols), groups: [group] });
  }
  return rows.map((r) => r.groups);
}
