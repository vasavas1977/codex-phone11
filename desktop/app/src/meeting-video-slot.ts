/** Own one SDK attachment; DOM removal alone does not release SDK references. */
export type AttachableVideo = {
  attach: () => HTMLMediaElement;
  detach: (element: HTMLMediaElement) => unknown;
};
export class MeetingVideoSlot {
  private current: { track: AttachableVideo; element: HTMLMediaElement } | null = null;
  update(track: AttachableVideo | undefined, mount: (element: HTMLMediaElement) => void): void {
    if (this.current?.track === track) return;
    this.clear();
    if (!track) return;
    const element = track.attach();
    this.current = { track, element };
    mount(element);
  }
  clear(): void {
    const previous = this.current;
    this.current = null;
    if (!previous) return;
    try { previous.track.detach(previous.element); }
    catch { /* Already-disposed SDK tracks must not prevent remaining cleanup. */ }
    finally { previous.element.remove(); }
  }
}
