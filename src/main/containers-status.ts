import { open } from 'node:fs/promises';
import {
  MAX_FILE_BYTES, STALE_AFTER_MS, parseStatusFile, summaryColour,
  type ContainerInfo, type ContainersSnapshot,
} from '@shared/containers';

/** Reads the status file: its bytes (at most `max` + 1) and modification time. */
export type StatusFileReader = (path: string, max: number) => Promise<{ bytes: Uint8Array; mtimeMs: number }>;

/** One open file handle: stat and read the same file, even if it is renamed over meanwhile. */
export const readStatusFile: StatusFileReader = async (path, max) => {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not a regular file');
    if (stat.size > max) return { bytes: new Uint8Array(max + 1), mtimeMs: stat.mtimeMs };
    const bytes = new Uint8Array(max + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return { bytes: bytes.subarray(0, total), mtimeMs: stat.mtimeMs };
  } finally {
    await handle.close();
  }
};

export interface ContainerStatusOptions {
  path: string;
  reader?: StatusFileReader;
  now?: () => number;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * The containers status file (written atomically by a system service). Read-only; untrusted:
 * size-capped, JSON only, every entry validated. A failed read keeps the last good data.
 */
export class ContainerStatusSource {
  private containers: ContainerInfo[] = [];
  private modifiedAt: number | null = null;
  private readAt: number | null = null;
  private attemptAt = 0;
  private error: string | null = null;
  private skipped = 0;
  private pending: Promise<ContainersSnapshot> | null = null;
  private readonly reader: StatusFileReader;
  private readonly now: () => number;

  constructor(private options: ContainerStatusOptions) {
    if (!options.path.startsWith('/')) throw new Error('The containers status file must be an absolute path');
    this.reader = options.reader ?? readStatusFile;
    this.now = options.now ?? Date.now;
  }

  get path(): string { return this.options.path; }

  /** Time since the last read attempt (ms); Infinity before the first. */
  get age(): number {
    return this.attemptAt ? this.now() - this.attemptAt : Infinity;
  }

  snapshot(): ContainersSnapshot {
    return {
      configured: true,
      containers: this.containers,
      modifiedAt: this.modifiedAt,
      readAt: this.readAt,
      error: this.error,
      stale: this.modifiedAt !== null && this.now() - this.modifiedAt > STALE_AFTER_MS,
      skipped: this.skipped,
    };
  }

  /** The tile dot. Unreadable or stale status is at least amber: something needs a look. */
  summary(): 'red' | 'amber' | 'green' | undefined {
    const colour = summaryColour(this.containers);
    const snap = this.snapshot();
    if ((snap.error || snap.stale) && colour !== 'red') return 'amber';
    return colour;
  }

  /** Re-read the file unless it was read less than `minAgeMs` ago. Concurrent calls share one read. */
  refresh(minAgeMs = 0): Promise<ContainersSnapshot> {
    if (this.pending) return this.pending;
    if (this.age < minAgeMs) return Promise.resolve(this.snapshot());
    this.attemptAt = this.now();
    this.pending = this.read().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async read(): Promise<ContainersSnapshot> {
    const max = this.options.maxBytes ?? MAX_FILE_BYTES;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), this.options.timeoutMs ?? 3000);
      });
      let file: { bytes: Uint8Array; mtimeMs: number };
      try { file = await Promise.race([this.reader(this.options.path, max), timeout]); }
      catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        throw new Error(code === 'ENOENT' ? 'The status file is missing'
          : code === 'EACCES' ? 'The status file cannot be read (permission denied)'
          : (e as Error).message === 'timeout' ? 'Reading the status file timed out'
          : 'The status file cannot be read');
      }
      if (file.bytes.byteLength > max) throw new Error('The status file is too large');
      let data: unknown;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)); }
      catch { throw new Error('The status file is not valid JSON'); }
      const { containers, skipped } = parseStatusFile(data);
      this.containers = containers;
      this.skipped = skipped;
      this.modifiedAt = Number.isFinite(file.mtimeMs) ? file.mtimeMs : this.now();
      this.readAt = this.now();
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message || 'The status file cannot be read';
    } finally {
      clearTimeout(timer);
    }
    return this.snapshot();
  }
}

export const NOT_CONFIGURED: ContainersSnapshot = {
  configured: false, containers: [], modifiedAt: null, readAt: null, error: null, stale: false, skipped: 0,
};
