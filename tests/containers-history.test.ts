import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContainerHistory } from '../src/main/containers-history';
import { HISTORY_BUCKETS, HISTORY_BUCKET_MS, parseEntry, type ContainerInfo } from '../src/shared/containers';

const T0 = 1_800_000_000_000 - (1_800_000_000_000 % HISTORY_BUCKET_MS);
const c = (name: string, colour: ContainerInfo['colour'], cpu: number | null = null, mem: number | null = null): ContainerInfo =>
  ({ id: 'a'.repeat(12), name, image: 'x:1', state: 'running', status: '', project: '', service: '', colour, word: '', line: '', description: '', cpu, mem });

describe('status file: description and usage', () => {
  const entry = (over: Record<string, unknown>) => parseEntry({ Id: 'a'.repeat(64), Names: ['/web'], State: 'running', Status: 'Up 1 hour', ...over });

  it('reads a description, CPU and memory', () => {
    expect(entry({ Description: '  Serves the site.‮ ', Cpu: 12.5, Mem: 1048576 })).toMatchObject({ description: 'Serves the site.', cpu: 12.5, mem: 1048576 });
  });

  it('drops values that are missing or not plausible', () => {
    expect(entry({})).toMatchObject({ description: '', cpu: null, mem: null });
    expect(entry({ Description: 7, Cpu: '5', Mem: -1 })).toMatchObject({ description: '', cpu: null, mem: null });
    expect(entry({ Cpu: Infinity, Mem: NaN })).toMatchObject({ cpu: null, mem: null });
    expect(entry({ Description: 'x'.repeat(500) })!.description).toHaveLength(240);
  });
});

describe('container history', () => {
  it('keeps the worst status of a slice and the share of readings that were running', () => {
    const h = new ContainerHistory();
    h.record([c('web', 'green', 10, 100)], T0);
    h.record([c('web', 'red', 30, 300)], T0 + 60_000);
    h.record([c('web', 'green', 20, 200)], T0 + HISTORY_BUCKET_MS);
    const s = h.series('web', T0 + HISTORY_BUCKET_MS);
    expect(s.points).toHaveLength(HISTORY_BUCKETS);
    expect(s.points.at(-2)).toEqual({ colour: 'red', cpu: 20, mem: 300 });
    expect(s.points.at(-1)).toEqual({ colour: 'green', cpu: 20, mem: 200 });
    expect(s.points[0]).toEqual({ colour: null, cpu: null, mem: null });
    expect(s.runningPct).toBeCloseTo(200 / 3);
    expect(s.coveredMs).toBe(2 * HISTORY_BUCKET_MS);
    expect(s.end).toBe(T0 + 2 * HISTORY_BUCKET_MS);
  });

  it('has no numbers for a container it never saw, or one without published usage', () => {
    const h = new ContainerHistory();
    h.record([c('web', 'grey')], T0);
    expect(h.series('other', T0)).toMatchObject({ runningPct: null, coveredMs: 0 });
    expect(h.series('web', T0).points.at(-1)).toEqual({ colour: 'grey', cpu: null, mem: null });
    expect(h.series('web', T0).runningPct).toBe(0);
  });

  it('forgets readings older than 24 hours', () => {
    const h = new ContainerHistory();
    h.record([c('old', 'green')], T0);
    h.record([c('new', 'green')], T0 + HISTORY_BUCKETS * HISTORY_BUCKET_MS);
    expect(JSON.stringify(h.toJSON())).not.toContain('old');
    expect(h.series('new', T0 + HISTORY_BUCKETS * HISTORY_BUCKET_MS).coveredMs).toBe(HISTORY_BUCKET_MS);
  });

  it('survives a restart through its file, written for this user only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofa-history-'));
    try {
      const file = join(dir, 'state', 'history.json');
      const h = new ContainerHistory();
      h.record([c('web', 'amber', 5, 50)], T0);
      await h.save(file);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const again = new ContainerHistory();
      await again.load(file, T0 + 60_000);
      expect(again.series('web', T0 + 60_000)).toEqual(h.series('web', T0 + 60_000));
      expect(JSON.parse(readFileSync(file, 'utf8')).v).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('ignores a damaged or hostile history file', async () => {
    const h = new ContainerHistory();
    const index = T0 / HISTORY_BUCKET_MS;
    h.restore({ v: 1, bucketMs: HISTORY_BUCKET_MS, names: {
      'bad name!': [[index, 1, 1, 0, 0, 0, -1]],
      web: [[index, 1, 5, 0, 0, 0, -1], [index, 1, 1, 9, 0, 0, -1], 'x', [index - 1, 2, 1, 2, 4, 2, 10]],
      __proto__: [[index, 1, 1, 0, 0, 0, -1]],
    } }, T0);
    h.restore({ v: 2 }, T0); h.restore('nope', T0); h.restore(null, T0);
    expect(h.series('web', T0).coveredMs).toBe(HISTORY_BUCKET_MS);
    expect(h.series('web', T0).points.at(-2)).toEqual({ colour: 'amber', cpu: 2, mem: 10 });
    expect(h.series('bad name!', T0).coveredMs).toBe(0);
    await h.load('/nonexistent/sofa/history.json', T0);
  });
});
