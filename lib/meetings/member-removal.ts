/** Server-admitted membership assertions, never media identities or display-name matching. */
export type RemovalMember = Readonly<{
  userId: number;
  expectedParticipantId: string;
  expectedRoomRevision: string;
  expectedMemberRevision: string;
  name?: string;
  state: "admitted" | "pending" | "completed" | "failed";
}>;
export type HostControlSnapshot = Readonly<{
  available: boolean;
  meetingId: string;
  tenantId?: number;
  members: readonly RemovalMember[];
}>;
export type MemberRemovalInput = Readonly<{
  tenantId: number; meetingId: string; targetUserId: number; expectedParticipantId: string;
  expectedRoomRevision: string; expectedMemberRevision: string;
}>;
export type MemberRemovalResult = Readonly<{
  operationId: string;
  expectedRoomRevision: string; expectedMemberRevision: string;
  state: "pending" | "completed" | "failed";
  providerAcknowledged: boolean;
  providerState?: "pending" | "processing" | "completed" | "failed";
  providerError?: "unavailable";
}>;
export type MemberRemovalApi = {
  snapshot(meetingId: string): Promise<HostControlSnapshot>;
  request(input: MemberRemovalInput): Promise<MemberRemovalResult>;
  poll(input: MemberRemovalInput): Promise<MemberRemovalResult>;
};
type RemovalView = Readonly<{
  available: boolean; loading: boolean; members: readonly RemovalMember[];
  tenantId?: number;
  busyUserId: number | null; error: string | null;
}>;
const empty: RemovalView = Object.freeze({ available: false, loading: false,
  members: Object.freeze([]), busyUserId: null, error: null });
const id = /^[A-Za-z0-9_-]{1,96}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each retained callback belongs to one owner object, admitted room and loaded row. */
export class MeetingMemberRemoval {
  private view: RemovalView = empty;
  private scope?: HostControlSnapshot;
  private generation = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private deniedSubjects = new Set<string>();
  private tenantId?: number;
  private roomRevision?: string;
  constructor(private readonly meetingId: string, private readonly ownerId: number,
    private readonly isCurrent: () => boolean, private readonly api: MemberRemovalApi) {}
  getSnapshot = (): RemovalView => this.view;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private current(generation = this.generation) {
    return !this.disposed && generation === this.generation && this.isCurrent();
  }
  private update(view: RemovalView) {
    this.view = Object.freeze(view); this.listeners.forEach(listener => listener());
  }
  async refresh(): Promise<void> {
    if (!this.current() || !uuid.test(this.meetingId)) return;
    const generation = ++this.generation;
    this.scope = undefined;
    this.update({ ...empty, loading: true });
    try {
      const scope = await this.api.snapshot(this.meetingId);
      if (!this.current(generation)) return;
      if (!scope.available) { this.update(empty); return; }
      if (scope.meetingId !== this.meetingId || !Number.isSafeInteger(scope.tenantId) || scope.tenantId! < 1 ||
        (this.tenantId !== undefined && this.tenantId !== scope.tenantId) ||
        scope.members.length > 50 || new Set(scope.members.map(member => member.userId)).size !== scope.members.length ||
        scope.members.some(member => !Number.isSafeInteger(member.userId) || member.userId < 1 ||
          member.userId === this.ownerId || !id.test(member.expectedParticipantId) ||
          !uuid.test(member.expectedRoomRevision) || !uuid.test(member.expectedMemberRevision) ||
          (this.roomRevision !== undefined && this.roomRevision !== member.expectedRoomRevision) ||
          member.expectedRoomRevision !== scope.members[0].expectedRoomRevision ||
          !["admitted", "pending", "completed", "failed"].includes(member.state) ||
          (member.state === "admitted" && this.deniedSubjects.has(member.expectedParticipantId)))) throw new Error("Invalid controls");
      scope.members.forEach(member => { if (member.state !== "admitted") this.deniedSubjects.add(member.expectedParticipantId); });
      this.scope = scope;
      this.tenantId = scope.tenantId;
      this.roomRevision ??= scope.members[0]?.expectedRoomRevision;
      this.update({ ...empty, available: true, tenantId: scope.tenantId, members: scope.members });
    } catch {
      if (this.current(generation)) this.update({ ...empty,
        error: "Meeting access controls could not be loaded. Refresh to recheck your host permission." });
    }
  }
  async act(member: RemovalMember, mode: "request" | "poll"): Promise<void> {
    if (!this.current() || !this.view.available || this.view.loading || this.view.busyUserId !== null ||
      !this.scope?.tenantId || !this.view.members.includes(member) || member.state === "completed" ||
      member.state === "failed" || (mode === "poll" && member.state !== "pending")) return;
    const generation = this.generation;
    const input: MemberRemovalInput = { tenantId: this.scope.tenantId, meetingId: this.meetingId,
      targetUserId: member.userId, expectedParticipantId: member.expectedParticipantId, expectedRoomRevision: member.expectedRoomRevision,
      expectedMemberRevision: member.expectedMemberRevision };
    this.update({ ...this.view, busyUserId: member.userId, error: null });
    try {
      const result = await this.api[mode](input);
      if (!this.current(generation)) return;
      if (!uuid.test(result.operationId) || result.expectedMemberRevision !== result.operationId ||
        result.expectedRoomRevision !== member.expectedRoomRevision || !["pending", "completed", "failed"].includes(result.state) ||
        result.providerAcknowledged !== (result.state === "completed")) throw new Error("Invalid status");
      this.deniedSubjects.add(member.expectedParticipantId);
      this.update({ ...this.view, busyUserId: null,
        members: this.view.members.map(row => row === member ? { ...row, state: result.state, expectedMemberRevision: result.expectedMemberRevision } : row) });
    } catch {
      if (this.current(generation)) {
        this.scope = undefined;
        // A failed read never restores an admitted state after local revocation.
        this.update({ ...empty, error: "Removal status is unavailable. Refresh to recheck meeting access; do not assume the member has left." });
      }
    }
  }
  dispose(): void {
    this.disposed = true; this.generation++; this.scope = undefined;
    this.deniedSubjects.clear();
    this.tenantId = undefined; this.roomRevision = undefined;
    this.update(empty); this.listeners.clear();
  }
}
