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
