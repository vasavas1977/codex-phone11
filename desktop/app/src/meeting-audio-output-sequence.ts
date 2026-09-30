/** Keeps browser device enumeration from reopening controls during a route switch. */
export class MeetingAudioOutputSequence {
  private revision = 0;
  private switching = false;
  private refreshPending = false;

  reset(): void {
    this.revision++;
    this.refreshPending = false;
  }

  beginRefresh(): number | null {
    if (this.switching) {
      this.refreshPending = true;
      return null;
    }
    return ++this.revision;
  }

  beginSwitch(): number | null {
    if (this.switching) return null;
    this.switching = true;
    return ++this.revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }

  finishSwitch(): boolean {
    this.switching = false;
    const refresh = this.refreshPending;
    this.refreshPending = false;
    return refresh;
  }
}
