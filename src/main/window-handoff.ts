/** Keep the outgoing fullscreen cover until the replacement has accepted focus.
 * A newer request cancels only the old hide; it cannot hide a newly opened panel.
 */
export class WindowHandoff {
  private revision = 0;
  private pending = 0;
  get active(): boolean { return this.pending > 0; }
  cancel(): void { this.revision++; }
  async run(activate: () => Promise<void>, hidePrevious: () => void): Promise<void> {
    const revision = ++this.revision;
    this.pending++;
    try {
      await activate();
      if (revision === this.revision) hidePrevious();
    } finally { this.pending--; }
  }
}

/** Wait for a compositor-ready renderer frame without an unbounded hidden-page wait. */
export async function waitForWindowPaint(paint: () => Promise<unknown>, timeoutMs = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      paint(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Window did not paint in time')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
