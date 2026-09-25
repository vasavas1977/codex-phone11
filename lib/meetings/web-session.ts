import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

import { BrowserMeetingConnectionFailure, BrowserMeetingSession, type BrowserRoom } from "./browser-session";
import { MeetingJoinFailure, safeMeetingJoinHttpStatus, type MeetingJoinStage } from "./join-failure";
import { clearActiveNativeMeeting, getActiveNativeMeeting, setActiveNativeMeeting } from "./native-session-registry";
import type { NativeMeetingAdmission, NativeMeetingPreferences } from "./native-session";

/** Browser media uses LiveKit's web Room; it never starts a native audio or SIP session. */
export class WebMeetingLifecycle {
  readonly session: BrowserMeetingSession;
  readonly wasInterruptedBySip = false;
  private unsubscribeOwner?: () => void;
  private unsubscribeSession?: () => void;
  private leaving?: Promise<void>;

  private constructor(
    readonly ownerId: number,
    readonly receiveOnly: boolean,
    createRoom: () => BrowserRoom,
  ) {
    this.session = new BrowserMeetingSession(createRoom);
    this.unsubscribeOwner = addAuthChangeListener(() => {
      if (getAuthSnapshot().user?.id !== ownerId) void this.leave().catch(() => undefined);
    });
    this.unsubscribeSession = this.session.subscribe(() => {
      if (this.session.getSnapshot().status === "disconnected") void this.leave().catch(() => undefined);
    });
  }

  get room(): BrowserRoom | undefined { return this.session.getRoom(); }

  static async join(
    expectedOwnerId: number,
    meetingId: string,
    admission: NativeMeetingAdmission,
    preferences: NativeMeetingPreferences,
  ): Promise<WebMeetingLifecycle> {
    if (!expectedOwnerId || !meetingId || getAuthSnapshot().user?.id !== expectedOwnerId)
      throw new MeetingJoinFailure("admission");
    const ownerId = expectedOwnerId;
    let stage: MeetingJoinStage = "bindings";
    let lifecycle: WebMeetingLifecycle | undefined;
    try {
      await getActiveNativeMeeting()?.leave();
      const client = await import("livekit-client");
      if (typeof client.Room !== "function") throw new Error("Web meeting client unavailable");
      if (getAuthSnapshot().user?.id !== ownerId) throw new MeetingJoinFailure("admission");
      lifecycle = new WebMeetingLifecycle(ownerId, admission.grant_profile === "listener", () => new client.Room() as unknown as BrowserRoom);
      stage = "signal_connect";
      await lifecycle.session.connect({
        url: admission.url,
        token: admission.token,
        microphone: preferences.microphone,
        camera: preferences.camera,
        receiveOnly: lifecycle.receiveOnly,
      });
      if (getAuthSnapshot().user?.id !== ownerId) throw new MeetingJoinFailure("post_connect_guard");
      setActiveNativeMeeting(lifecycle);
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
