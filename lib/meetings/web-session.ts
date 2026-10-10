import { addAuthChangeListener, getAuthSnapshot, type User } from "@/lib/_core/auth";

import type { LocalParticipant, LocalTrack } from "livekit-client";
import { BrowserMeetingConnectionFailure, BrowserMeetingSession, type BrowserRoom, type BrowserScreenAdapter } from "./browser-session";
import { MeetingJoinFailure, safeMeetingJoinHttpStatus, type MeetingJoinStage } from "./join-failure";
import { clearActiveNativeMeeting, getActiveNativeMeeting, setActiveNativeMeeting } from "./native-session-registry";
import type { NativeMeetingAdmission, NativeMeetingPreferences } from "./native-session";

type WebMeetingOwner = { user: User; retired: boolean };
function ownerIsCurrent(owner: WebMeetingOwner): boolean {
  if (getAuthSnapshot().user !== owner.user) owner.retired = true;
  return !owner.retired;
}

/** Connected provider permissions, not the unconsumed tenant policy model or host authority. */
function screenAdapter(client: typeof import("livekit-client")): BrowserScreenAdapter | undefined {
  if (typeof client.Track?.sourceToProto !== "function") return undefined;
  const source = client.Track.sourceToProto(client.Track.Source.ScreenShare);
  const participant = (room: BrowserRoom) => room.localParticipant as unknown as LocalParticipant;
  return {
    isAllowed(room) {
      const local = participant(room), permissions = local.permissions;
      return globalThis.isSecureContext === true && typeof globalThis.navigator?.mediaDevices?.getDisplayMedia === "function" &&
        typeof local.createScreenTracks === "function" && typeof local.publishTrack === "function" &&
        typeof local.unpublishTrack === "function" && permissions?.canPublish === true &&
        Array.isArray(permissions.canPublishSources) &&
        (permissions.canPublishSources.length === 0 || permissions.canPublishSources.includes(source));
    },
    capture: room => participant(room).createScreenTracks({ audio: false }),
    publish: (room, track) => participant(room).publishTrack(track as LocalTrack),
    unpublish: (room, track) => participant(room).unpublishTrack(track as LocalTrack, true),
    isPublished: (room, track) => Array.from(participant(room).trackPublications.values()).some(publication =>
      publication.track === track && !publication.isMuted && track.mediaStreamTrack.readyState === "live"),
    publishedTracks: room => Array.from(participant(room).trackPublications.values()).flatMap(publication =>
      publication.track && (publication.source === client.Track.Source.ScreenShare || publication.source === client.Track.Source.ScreenShareAudio)
        ? [publication.track] : []),
  };
}

/** Browser media uses LiveKit's web Room; it never starts a native audio or SIP session. */
export class WebMeetingLifecycle {
  private static joinGeneration = 0;
  private static pendingJoin?: Promise<WebMeetingLifecycle>;
  readonly session: BrowserMeetingSession;
  readonly wasInterruptedBySip = false;
  private unsubscribeOwner?: () => void;
  private unsubscribeSession?: () => void;
  private leaving?: Promise<void>;

  private constructor(
    readonly ownerId: number,
    readonly meetingId: string,
    readonly receiveOnly: boolean,
    createRoom: () => BrowserRoom,
    private readonly owner: WebMeetingOwner,
    screen?: BrowserScreenAdapter,
  ) {
    this.session = new BrowserMeetingSession(createRoom, { isCurrentOwner: () => ownerIsCurrent(this.owner), screen: screen && {
      ...screen,
      isAllowed: room => ownerIsCurrent(this.owner) && getActiveNativeMeeting(ownerId) === this && screen.isAllowed(room),
    } });
    this.unsubscribeOwner = addAuthChangeListener(() => {
      if (!ownerIsCurrent(this.owner)) void this.leave().catch(() => undefined);
    });
    this.unsubscribeSession = this.session.subscribe(() => {
      if (this.session.getSnapshot().status === "disconnected") void this.leave().catch(() => undefined);
    });
  }

  // Keep failed teardown reachable inside the controller without exposing the
  // old room's tracks to a newly signed-in UI that has the same numeric ID.
  get room(): BrowserRoom | undefined { return ownerIsCurrent(this.owner) ? this.session.getRoom() : undefined; }

  static join(
    expectedOwnerId: number,
    meetingId: string,
    admission: NativeMeetingAdmission,
    preferences: NativeMeetingPreferences,
  ): Promise<WebMeetingLifecycle> {
    const user = getAuthSnapshot().user;
    if (!expectedOwnerId || !meetingId || !user || user.id !== expectedOwnerId)
      return Promise.reject(new MeetingJoinFailure("admission"));
    const owner: WebMeetingOwner = { user, retired: false };
    // Subscribe before the first await: a logout retires even a queued join,
    // including a later restoration of the exact same user object.
    const unsubscribePendingOwner = addAuthChangeListener(() => { ownerIsCurrent(owner); });
    const generation = ++this.joinGeneration;
    const previous = this.pendingJoin;
    // A connecting room is not yet in the active registry. Wait for its
    // guarded completion and teardown before another room can capture media.
    const task = (async () => {
      await previous?.catch(() => undefined);
      if (!ownerIsCurrent(owner)) throw new MeetingJoinFailure("admission");
      if (generation !== this.joinGeneration)
        throw new MeetingJoinFailure("post_connect_guard");
      return this.joinCurrent(generation, owner, meetingId, admission, preferences);
    })();
    this.pendingJoin = task;
    void task.finally(() => {
      unsubscribePendingOwner();
      if (this.pendingJoin === task) this.pendingJoin = undefined;
    }).catch(() => undefined);
    return task;
  }

  private static async joinCurrent(
    generation: number,
    owner: WebMeetingOwner,
    meetingId: string,
    admission: NativeMeetingAdmission,
    preferences: NativeMeetingPreferences,
  ): Promise<WebMeetingLifecycle> {
    if (!meetingId || !ownerIsCurrent(owner))
      throw new MeetingJoinFailure("admission");
    const ownerId = owner.user.id;
    let stage: MeetingJoinStage = "bindings";
    let lifecycle: WebMeetingLifecycle | undefined;
    try {
      await getActiveNativeMeeting()?.leave();
      if (!ownerIsCurrent(owner)) throw new MeetingJoinFailure("admission");
      if (generation !== this.joinGeneration) throw new MeetingJoinFailure("post_connect_guard");
      const client = await import("livekit-client");
      if (typeof client.Room !== "function") throw new Error("Web meeting client unavailable");
      if (!ownerIsCurrent(owner)) throw new MeetingJoinFailure("admission");
      if (generation !== this.joinGeneration) throw new MeetingJoinFailure("post_connect_guard");
      lifecycle = new WebMeetingLifecycle(ownerId, meetingId, admission.grant_profile === "listener",
        () => new client.Room() as unknown as BrowserRoom, owner,
        admission.grant_profile === "interactive" ? screenAdapter(client) : undefined);
      stage = "signal_connect";
      await lifecycle.session.connect({
        url: admission.url,
        token: admission.token,
        microphone: preferences.microphone,
        camera: preferences.camera,
        receiveOnly: lifecycle.receiveOnly,
      });
      if (generation !== this.joinGeneration || !ownerIsCurrent(owner))
        throw new MeetingJoinFailure("post_connect_guard");
      setActiveNativeMeeting(lifecycle);
      // Refresh the capability only after this exact lifecycle is registered as owner.
      lifecycle.session.refreshScreenCapability();
      return lifecycle;
    } catch (error) {
      if (lifecycle) {
        try { await lifecycle.leave(); }
        catch {
          // Keep a failed SDK teardown reachable for retry on the next join
          // or auth cleanup; local capture must not become orphaned.
          setActiveNativeMeeting(lifecycle);
        }
      }
      if (error instanceof MeetingJoinFailure) throw error;
      const failureStage = error instanceof BrowserMeetingConnectionFailure ? error.stage : stage;
      let diagnostic = {};
      try {
        const client = await import("livekit-client");
        if (error instanceof client.ConnectionError) {
          diagnostic = { httpStatus: safeMeetingJoinHttpStatus(error.status) };
        }
      } catch { /* Binding failures retain their fixed stage only. */ }
      throw new MeetingJoinFailure(failureStage, diagnostic, error);
    }
  }

  leave(): Promise<void> {
    if (this.leaving) return this.leaving;
    this.leaving = this.session.disconnect().then(() => {
      this.unsubscribeSession?.();
      this.unsubscribeOwner?.();
      this.unsubscribeSession = undefined;
      this.unsubscribeOwner = undefined;
      clearActiveNativeMeeting(this);
    }).finally(() => { this.leaving = undefined; });
    return this.leaving;
  }
}
