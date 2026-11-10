/** Drops repeat triggers of the same key within `ms` (a held remote button auto-repeats). */
export class Debouncer {
  private last = new Map<string, number>();
  constructor(private readonly ms = 400, private readonly now: () => number = Date.now) {}
  allow(key: string): boolean {
    const t = this.now();
    const prev = this.last.get(key);
    this.last.set(key, t);
    return prev === undefined || t - prev >= this.ms;
  }
}
