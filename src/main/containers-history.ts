import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  HISTORY_BUCKETS, HISTORY_BUCKET_MS, NAME_PATTERN,
  type ContainerColour, type ContainerHistorySeries, type ContainerInfo, type HistoryPoint,
} from '@shared/containers';

/** Worst first when a slice saw more than one status: a short outage must stay visible. */
const SEVERITY: ContainerColour[] = ['green', 'grey', 'amber', 'red'];
const MAX_NAMES = 500;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

/** One slice: readings, green readings, worst severity, CPU sum and count, peak memory (-1: none). */
type Bucket = [n: number, up: number, worst: number, cpuSum: number, cpuN: number, mem: number];

/**
 * What the launcher has seen of each container over the last 24 hours, in ten-minute slices.
 * Built from the same status file as the view, so it covers only the time the launcher was
 * running and the file was fresh; the rest is shown as "no reading", never guessed.
 */
export class ContainerHistory {
  private names = new Map<string, Map<number, Bucket>>();
  private dirty = false;

  /** Add one reading of every container. */
  record(containers: ContainerInfo[], now: number): void {
    const index = Math.floor(now / HISTORY_BUCKET_MS);
    for (const c of containers) {
      let buckets = this.names.get(c.name);
      if (!buckets) {
        if (this.names.size >= MAX_NAMES) continue;
        this.names.set(c.name, buckets = new Map());
      }
      const b = buckets.get(index) ?? [0, 0, 0, 0, 0, -1];
      b[0]++;
      if (c.colour === 'green') b[1]++;
      b[2] = Math.max(b[2], SEVERITY.indexOf(c.colour));
      if (c.cpu !== null) { b[3] += c.cpu; b[4]++; }
      if (c.mem !== null) b[5] = Math.max(b[5], c.mem);
      buckets.set(index, b);
    }
    this.prune(index);
    this.dirty = true;
  }

  private prune(index: number): void {
    const oldest = index - HISTORY_BUCKETS + 1;
    for (const [name, buckets] of this.names) {
      for (const i of buckets.keys()) if (i < oldest || i > index) buckets.delete(i);
      if (!buckets.size) this.names.delete(name);
    }
  }

  series(name: string, now: number): ContainerHistorySeries {
    const last = Math.floor(now / HISTORY_BUCKET_MS);
    const buckets = this.names.get(name);
    const points: HistoryPoint[] = [];
    let n = 0, up = 0, covered = 0;
    for (let i = last - HISTORY_BUCKETS + 1; i <= last; i++) {
      const b = buckets?.get(i);
      if (!b) { points.push({ colour: null, cpu: null, mem: null }); continue; }
      n += b[0]; up += b[1]; covered++;
      points.push({ colour: SEVERITY[b[2]] ?? 'amber', cpu: b[4] ? b[3] / b[4] : null, mem: b[5] >= 0 ? b[5] : null });
    }
    return {
      bucketMs: HISTORY_BUCKET_MS, end: (last + 1) * HISTORY_BUCKET_MS, points,
      runningPct: n ? (up / n) * 100 : null, coveredMs: covered * HISTORY_BUCKET_MS,
    };
  }

  // ---- persistence: history survives a launcher restart ----------------------

  toJSON(): unknown {
    return { v: 1, bucketMs: HISTORY_BUCKET_MS, names: Object.fromEntries([...this.names].map(([name, b]) => [name, [...b].map(([i, v]) => [i, ...v])])) };
  }

  /** Load saved history. Untrusted like any file: anything malformed is skipped. */
  restore(data: unknown, now: number): void {
    if (!data || typeof data !== 'object') return;
    const d = data as { v?: unknown; bucketMs?: unknown; names?: unknown };
    if (d.v !== 1 || d.bucketMs !== HISTORY_BUCKET_MS || !d.names || typeof d.names !== 'object' || Array.isArray(d.names)) return;
    const whole = (x: unknown, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;
    for (const [name, rows] of Object.entries(d.names as Record<string, unknown>).slice(0, MAX_NAMES)) {
      if (!NAME_PATTERN.test(name) || !Array.isArray(rows)) continue;
      const buckets = new Map<number, Bucket>();
      for (const row of rows.slice(0, HISTORY_BUCKETS)) {
        if (!Array.isArray(row) || row.length !== 7) continue;
        const [i, count, up, worst, cpuSum, cpuN, mem] = row as number[];
        if (!whole(i, 1e9) || !whole(count, 1e6) || !whole(up, count!) || !whole(worst, 3) || !whole(cpuN, count!)) continue;
        if (typeof cpuSum !== 'number' || !Number.isFinite(cpuSum) || cpuSum < 0 || typeof mem !== 'number' || !Number.isFinite(mem) || mem < -1) continue;
        buckets.set(i!, [count!, up!, worst!, cpuSum, cpuN!, mem]);
      }
      if (buckets.size) this.names.set(name, buckets);
    }
    this.prune(Math.floor(now / HISTORY_BUCKET_MS));
  }

  async load(path: string, now: number): Promise<void> {
    try {
      const raw = await readFile(path);
      if (raw.byteLength <= MAX_HISTORY_BYTES) this.restore(JSON.parse(raw.toString('utf8')), now);
    } catch { /* no history yet, or unreadable: start empty */ }
  }

  /** Write the history if it changed (atomically, readable by this user only). */
  async save(path: string): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(`${path}.tmp`, JSON.stringify(this.toJSON()), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } catch { this.dirty = true; }
  }
}
