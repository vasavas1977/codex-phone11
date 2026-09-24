/** Serializes teardown with any media operation that may be waiting for OS permission. */
export class MeetingMediaLifecycle {
  private generation = 0;
  private closing = false;
  private readonly pending = new Set<Promise<unknown>>();

  run<T>(work: (current: () => boolean) => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Meeting is closing'));
    const generation = this.generation;
    const operation = Promise.resolve().then(() => work(() => !this.closing && this.generation === generation));
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
    return operation;
  }

  async cancelAndDrain(): Promise<void> {
    this.closing = true;
    this.generation++;
    // A running operation must check current() after each await before starting another.
    await Promise.allSettled([...this.pending]);
  }
}

/** Owns only the local, unpublished camera stream shown before admission. */
export class PrejoinCameraPreview {
  private generation = 0;
  private stream: MediaStream | null = null;
  private readonly pending = new Set<Promise<MediaStream | null>>();

  start(acquire: () => Promise<MediaStream>): Promise<MediaStream | null> {
    this.stop();
    const generation = this.generation;
    const operation = (async () => {
      const stream = await acquire();
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return null;
      }
      this.stream = stream;
      return stream;
    })();
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
    return operation;
  }

  stop(): void {
    this.generation++;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.pending]);
  }
}
