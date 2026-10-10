/** Captures microphone audio only for a local prejoin level meter; it never records or publishes. */
export class PrejoinMicrophoneCheck {
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private frame: number | null = null;

  async start(
    acquire: () => Promise<MediaStream>,
    createContext: () => AudioContext,
    requestFrame: (callback: FrameRequestCallback) => number,
    cancelFrame: (handle: number) => void,
    onLevel: (level: number) => void,
  ): Promise<boolean> {
    this.stop(cancelFrame);
    const generation = this.generation;
    let acquired: MediaStream | null = null;
    try {
      acquired = await acquire();
      if (generation !== this.generation) {
        acquired.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = acquired;
      const context = createContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return false;

      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const source = context.createMediaStreamSource(acquired);
      this.source = source;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const sample = () => {
        if (generation !== this.generation || !this.stream) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        // Normalize a conservative RMS level into a UI meter percentage.
        onLevel(Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 300)));
        this.frame = requestFrame(sample);
      };
      sample();
      return true;
    } catch (cause) {
      if (generation === this.generation) this.stop(cancelFrame);
      throw cause;
    }
  }

  /** Stops tracks synchronously so join, close, and SIP preemption can release capture immediately. */
  stop(cancelFrame: (handle: number) => void): void {
    this.generation++;
    if (this.frame !== null) cancelFrame(this.frame);
    this.frame = null;
    try { this.source?.disconnect(); } catch { /* Context teardown continues. */ }
    this.source = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => undefined);
  }
}
