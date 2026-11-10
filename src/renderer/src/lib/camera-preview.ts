/** A still remains visible until a decoded live frame; late requests cannot cover live video. */
export class CameraPreview {
  private generation = 0;
  private live = false;
  constructor(private changed: (image: string | null, live: boolean) => void) {}
  start(load: () => Promise<string | null>): void {
    const generation = ++this.generation;
    this.live = false;
    this.changed(null, false);
    void load().then(image => {
      if (generation === this.generation && !this.live) this.changed(image, false);
    }).catch(() => undefined);
  }
  frame(): void { this.live = true; this.changed(null, true); }
  stop(): void { this.generation++; }
}
