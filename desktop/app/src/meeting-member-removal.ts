import { MeetingMemberRemoval, type HostControlSnapshot, type MemberRemovalApi,
  type MemberRemovalInput, type MemberRemovalResult, type RemovalMember } from '../../../lib/meetings/member-removal';

export type DesktopRemovalView = ReturnType<MeetingMemberRemoval['getSnapshot']>;
export type DesktopRemovalRow = Pick<RemovalMember, 'userId' | 'expectedParticipantId' | 'expectedRoomRevision' | 'expectedMemberRevision'>;
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const bad = (): never => { throw new Error('Meeting access unavailable'); };

/** Parse presentation data and assertions separately from media identities. */
export function readHostControls(value: unknown, meetingId: string, tenantId: number, ownerId: number): HostControlSnapshot {
  if (!record(value) || !keys(value, ['available', 'meetingId', 'tenantId', 'members']) ||
      value.meetingId !== meetingId || typeof value.available !== 'boolean' || !Array.isArray(value.members)) return bad();
  if (!value.available) {
    if (value.members.length || value.tenantId !== undefined) return bad();
    return Object.freeze({ available: false, meetingId, members: Object.freeze([]) });
  }
  if (value.tenantId !== tenantId || value.members.length > 50) return bad();
  const seen = new Set<number>();
  let roomRevision: string | undefined;
  const members = value.members.map((raw): RemovalMember => {
    if (!record(raw) || !keys(raw, ['userId', 'expectedParticipantId', 'expectedRoomRevision', 'expectedMemberRevision', 'name', 'state']) ||
        !positive(raw.userId) || raw.userId === ownerId || seen.has(raw.userId) ||
        typeof raw.expectedParticipantId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(raw.expectedParticipantId) ||
        !uuid(raw.expectedRoomRevision) || !uuid(raw.expectedMemberRevision) ||
        (roomRevision !== undefined && roomRevision !== raw.expectedRoomRevision) ||
        !['admitted', 'pending', 'completed', 'failed'].includes(raw.state as string)) return bad();
    if (raw.name !== undefined && (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 200 ||
        /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(raw.name))) return bad();
    roomRevision = raw.expectedRoomRevision;
    seen.add(raw.userId);
    return Object.freeze({ userId: raw.userId, expectedParticipantId: raw.expectedParticipantId,
      expectedRoomRevision: raw.expectedRoomRevision, expectedMemberRevision: raw.expectedMemberRevision,
      ...(raw.name === undefined ? {} : { name: (raw.name as string).trim() }), state: raw.state as RemovalMember['state'] });
  });
  return Object.freeze({ available: true, meetingId, tenantId, members: Object.freeze(members) });
}

export function validRemovalInput(value: unknown): value is MemberRemovalInput {
  return record(value) && Object.keys(value).length === 6 && keys(value,
    ['tenantId', 'meetingId', 'targetUserId', 'expectedParticipantId', 'expectedRoomRevision', 'expectedMemberRevision']) &&
    positive(value.tenantId) && positive(value.targetUserId) && uuid(value.meetingId) &&
    typeof value.expectedParticipantId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value.expectedParticipantId) &&
    uuid(value.expectedRoomRevision) && uuid(value.expectedMemberRevision);
}

export function readRemovalResult(value: unknown, input: MemberRemovalInput): MemberRemovalResult {
  if (!record(value) || !keys(value, ['operationId', 'expectedRoomRevision', 'expectedMemberRevision', 'state',
      'providerAcknowledged', 'providerState', 'providerError']) || !uuid(value.operationId) ||
      value.expectedMemberRevision !== value.operationId || value.expectedRoomRevision !== input.expectedRoomRevision ||
      !['pending', 'completed', 'failed'].includes(value.state as string) ||
      value.providerAcknowledged !== (value.state === 'completed') ||
      (value.providerState !== undefined && !['pending', 'processing', 'completed', 'failed'].includes(value.providerState as string)) ||
      (value.providerError !== undefined && value.providerError !== 'unavailable')) return bad();
  return Object.freeze({ operationId: value.operationId, expectedRoomRevision: input.expectedRoomRevision,
    expectedMemberRevision: value.operationId, state: value.state as MemberRemovalResult['state'],
    providerAcknowledged: value.providerAcknowledged as boolean,
    ...(value.providerState === undefined ? {} : { providerState: value.providerState as MemberRemovalResult['providerState'] }),
    ...(value.providerError === undefined ? {} : { providerError: 'unavailable' as const }) });
}

/** Main-process authority: renderer callbacks must still match a currently loaded exact row. */
export class DesktopMeetingMemberRemoval {
  readonly controller: MeetingMemberRemoval;
  private disposed = false;
  constructor(readonly meetingId: string, readonly tenantId: number, readonly ownerId: number,
    private readonly isCurrent: () => boolean, api: MemberRemovalApi) {
    this.controller = new MeetingMemberRemoval(meetingId, ownerId, () => this.current(), {
      snapshot: async id => readHostControls(await api.snapshot(id), id, tenantId, ownerId),
      request: input => this.perform(api, input, 'request'),
      poll: input => this.perform(api, input, 'poll'),
    });
  }
  private async perform(api: MemberRemovalApi, input: MemberRemovalInput, mode: 'request' | 'poll') {
    const row = this.row({ userId: input.targetUserId, ...input });
    if (!row) return bad();
    const result = readRemovalResult(await api[mode](input), input);
    // A pending retry/poll belongs to the original operation, even for a valid UUID response.
    if ((row.state !== 'admitted' || mode === 'poll') && result.operationId !== input.expectedMemberRevision) return bad();
    return result;
  }
  row(raw: unknown): RemovalMember | undefined {
    if (!this.current() || !record(raw)) return undefined;
    const view = this.controller.getSnapshot();
    if (!view.available || view.loading) return undefined;
    return view.members.find(row => row.userId === raw.userId && row.expectedParticipantId === raw.expectedParticipantId &&
      row.expectedRoomRevision === raw.expectedRoomRevision && row.expectedMemberRevision === raw.expectedMemberRevision);
  }
  current(): boolean {
    if (!this.disposed && !this.isCurrent()) this.dispose();
    return !this.disposed;
  }
  async refresh(): Promise<DesktopRemovalView> {
    if (!this.current()) return bad();
    await this.controller.refresh(); return this.controller.getSnapshot();
  }
  async act(raw: unknown, mode: 'request' | 'poll'): Promise<DesktopRemovalView> {
    const row = this.row(raw);
    if (!row) return bad();
    await this.controller.act(row, mode);
    return this.controller.getSnapshot();
  }
  dispose(): void { this.disposed = true; this.controller.dispose(); }
}

export const removalRow = (row: RemovalMember): DesktopRemovalRow => ({ userId: row.userId,
  expectedParticipantId: row.expectedParticipantId, expectedRoomRevision: row.expectedRoomRevision,
  expectedMemberRevision: row.expectedMemberRevision });
const emptyView: DesktopRemovalView = Object.freeze({ available: false, loading: false,
  members: Object.freeze([]), busyUserId: null, error: null });

/** Isolated preload lifetime: a connection loss permanently retires all retained callbacks. */
export class DesktopMeetingRemovalClient {
  private disposed = false;
  private generation = 0;
  private view = emptyView;
  constructor(private readonly isCurrent: () => boolean,
    private readonly transport: { refresh(): Promise<DesktopRemovalView>;
      act(row: DesktopRemovalRow, mode: 'request' | 'poll'): Promise<DesktopRemovalView>; retire(): void },
    private readonly changed: (view: DesktopRemovalView) => void) {}
  getSnapshot(): DesktopRemovalView { return this.view; }
  current(): boolean {
    if (!this.disposed && !this.isCurrent()) this.dispose();
    return !this.disposed;
  }
  private update(view: DesktopRemovalView): void { this.view = view; this.changed(view); }
  private async run(action: () => Promise<DesktopRemovalView>, busyUserId: number | null): Promise<void> {
    if (!this.current() || this.view.loading || this.view.busyUserId !== null) return;
    const generation = ++this.generation;
    this.update(busyUserId === null ? { ...emptyView, loading: true } : { ...this.view, busyUserId, error: null });
    try {
      const view = await action();
      if (this.current() && generation === this.generation) this.update(view);
    } catch {
      if (this.current() && generation === this.generation) this.update({ ...emptyView,
        error: 'Meeting access controls are unavailable. Refresh to recheck your host permission; departure is not confirmed.' });
    }
  }
  refresh(): Promise<void> { return this.run(() => this.transport.refresh(), null); }
  act(row: RemovalMember, mode: 'request' | 'poll'): Promise<void> {
    if (!this.current() || !this.view.available || !this.view.members.includes(row) ||
        (mode === 'poll' ? row.state !== 'pending' : !['admitted', 'pending'].includes(row.state))) return Promise.resolve();
    return this.run(() => this.transport.act(removalRow(row), mode), row.userId);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.generation;
    this.transport.retire(); this.update(emptyView);
  }
}
