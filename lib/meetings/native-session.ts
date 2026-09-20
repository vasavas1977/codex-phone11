import { Platform } from "react-native";

import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

import {
  BrowserMeetingSession,
  type BrowserRoom,
} from "./browser-session";
import { MediaOwnershipCoordinator, type MediaLease } from "./media-ownership";
import {
  clearActiveNativeMeeting,
  getActiveNativeMeeting,
  setActiveNativeMeeting,
} from "./native-session-registry";
import { useSipCallStore } from "../sip/call-store";

export type NativeMeetingAdmission = Readonly<{
  url: string;
  token: string;
  /** Server-derived from durable membership; no client can opt into listener mode. */
  grant_profile?: "interactive" | "listener";
}>;
export type NativeMeetingPreferences = Readonly<{
  microphone: boolean;
  camera: boolean;
}>;

type NativeBindings = {
  Room: new () => BrowserRoom;
  startAudioSession: () => Promise<void>;
  stopAudioSession: () => Promise<void>;
};

let bindingsPromise: Promise<NativeBindings> | undefined;
/** The one authority for SIP and meeting microphone/camera ownership. */
export const phone11MediaOwnership = new MediaOwnershipCoordinator();

function hasLiveSipCall() {
  const calls = useSipCallStore.getState();
  return Boolean(calls.incomingCall && calls.incomingCall.status !== "disconnected") ||
    Object.values(calls.activeCalls).some((call) => call.status !== "disconnected");
}

async function loadNativeBindings(): Promise<NativeBindings> {
  if (Platform.OS === "web") throw new Error("Meetings require the Phone11 mobile app.");
  if (!bindingsPromise) {
    bindingsPromise = Promise.all([
      import("@livekit/react-native"),
      import("livekit-client"),
    ]).then(([native, client]) => {
      if (typeof native.registerGlobals !== "function" || typeof client.Room !== "function") {
        throw new Error("Meetings require a current Phone11 build.");
      }
      // Phone11 owns SIP and CallKit. Do not let the SDK automatically
      // configure the shared iOS audio session outside our lease boundary.
      native.registerGlobals({ autoConfigureAudioSession: false });
      return {
        Room: client.Room as unknown as NativeBindings["Room"],
        startAudioSession: native.AudioSession.startAudioSession,
        stopAudioSession: native.AudioSession.stopAudioSession,
      };
    }).catch((error) => {
      bindingsPromise = undefined;
      throw error;
    });
  }
  return bindingsPromise;
}

/**
 * Owns one already-authorized native room. It accepts no room, identity, or
 * credential construction input: the server admission is passed through as-is.
 */
export class NativeMeetingLifecycle {
  readonly session: BrowserMeetingSession;
  private lease?: MediaLease;
  private leaving = false;
  private releaseTask?: Promise<void>;
  private mediaReleased = false;
  private audioStarted = false;
  private audioStopped = false;
  private unsubscribe?: () => void;
  private unsubscribeOwner?: () => void;
  private bindings?: NativeBindings;
  private interruptedBySip = false;

  private constructor(
    readonly meetingId: string,
    readonly ownerId: number,
    readonly receiveOnly: boolean,
    createRoom: () => BrowserRoom,
  ) {
    this.session = new BrowserMeetingSession(createRoom);
  }

  /** Existing LiveKit room only; this never constructs room, identity, or credentials. */
  get room(): BrowserRoom | undefined {
    return this.session.getRoom();
  }

  get wasInterruptedBySip(): boolean {
    return this.interruptedBySip;
  }

  private ownerIsCurrent(): boolean {
    return getAuthSnapshot().user?.id === this.ownerId;
  }

  private watchAuthenticatedOwner(): void {
    this.unsubscribeOwner = addAuthChangeListener(() => {
      if (!this.ownerIsCurrent()) void this.leave().catch(() => undefined);
    });
  }

  static async join(
    meetingId: string,
    admission: NativeMeetingAdmission,
    preferences: NativeMeetingPreferences,
  ): Promise<NativeMeetingLifecycle> {
    const owner = getAuthSnapshot().user;
    if (!owner) throw new Error("Sign in before joining a meeting.");
    if (!meetingId || hasLiveSipCall()) throw new Error("Finish your Phone call before joining a meeting.");
    // A different account can never retain a process-global native room.
    const previous = getActiveNativeMeeting();
    if (previous) await previous.leave();
    const bindings = await loadNativeBindings();
    if (getAuthSnapshot().user?.id !== owner.id) throw new Error("Your Phone11 account changed before the meeting could connect.");
    const lifecycle = new NativeMeetingLifecycle(
      meetingId,
      owner.id,
      admission.grant_profile === "listener",
      () => new bindings.Room(),
    );
    lifecycle.bindings = bindings;
    lifecycle.watchAuthenticatedOwner();
    const hooks = {
      pauseForSip: () => {
        lifecycle.interruptedBySip = true;
        return lifecycle.leave();
      },
    };
    // A user-initiated rejoin after SIP releases its lease is the coordinator's
    // explicit resume operation. It never resumes automatically or reuses a token.
    const request = phone11MediaOwnership.getSnapshot().interruptedMeetingId === meetingId
      ? phone11MediaOwnership.resumeMeeting(meetingId, hooks)
      : phone11MediaOwnership.requestMeeting(meetingId, hooks);
    lifecycle.lease = request.lease;
    lifecycle.unsubscribe = lifecycle.session.subscribe(() => {
      const status = lifecycle.session.getSnapshot().status;
      // BrowserMeetingSession emits its local "disconnected" state before it
      // awaits Room.disconnect(true). The lifecycle owns that local path so it
      // can stop tracks before audio; only an external disconnect releases here.
      if (status === "disconnected" && !lifecycle.leaving) void lifecycle.releaseAfterMediaStops();
    });
    try {
      await request.ready;
      if (!lifecycle.ownerIsCurrent()) throw new Error("Your Phone11 account changed before the meeting could connect.");
      if (hasLiveSipCall() || !phone11MediaOwnership.isCurrent(request.lease)) {
        throw new Error("A Phone call started before the meeting could connect.");
      }
      // The native SDK requires its manually managed audio session before a
      // room starts connecting. Starting it afterwards makes an otherwise
      // valid server-issued admission fail at the native media boundary.
      await bindings.startAudioSession();
      lifecycle.audioStarted = true;
      if (!lifecycle.ownerIsCurrent() || hasLiveSipCall() || !phone11MediaOwnership.isCurrent(request.lease)) {
        await lifecycle.releaseAfterMediaStops().catch(() => undefined);
        throw new Error("A Phone call started before the meeting audio could start.");
      }
      await lifecycle.session.connect({
        url: admission.url,
        token: admission.token,
        microphone: preferences.microphone,
        camera: preferences.camera,
        receiveOnly: lifecycle.receiveOnly,
      });
      if (!lifecycle.ownerIsCurrent() || !phone11MediaOwnership.isCurrent(request.lease)) throw new Error("Meeting connection was cancelled.");
      // SIP can acquire the lease while native setup or room connection is
      // awaiting. Do not publish this room as active unless this exact meeting
      // still owns it.
      if (!lifecycle.ownerIsCurrent() || hasLiveSipCall() || !phone11MediaOwnership.isCurrent(request.lease)) {
        await lifecycle.releaseAfterMediaStops().catch(() => undefined);
        throw new Error("A Phone call started before the meeting audio could start.");
      }
      setActiveNativeMeeting(lifecycle);
      return lifecycle;
    } catch (error) {
      await lifecycle.leave().catch(() => undefined);
      throw error;
    }
  }

  /** Stop tracks and audio before making the SIP session eligible to own media. */
  async leave(): Promise<void> {
    this.leaving = true;
    try {
      await this.session.disconnect();
    } finally {
      await this.releaseAfterMediaStops();
    }
  }

  async releaseAfterMediaStops(): Promise<void> {
    if (this.releaseTask) return this.releaseTask;
    const cleanup = (async () => {
      let audioError: unknown;
      // BrowserMeetingSession.disconnect(true) stops all local tracks first.
      // A failed native audio stop is surfaced, but cannot retain a room,
      // media lease, or old-account registry entry. A later leave retries it.
      if (this.bindings && this.audioStarted && !this.audioStopped) {
        try {
          await this.bindings.stopAudioSession();
          this.audioStopped = true;
        } catch (error) {
          audioError = error;
        }
      }
      if (!this.mediaReleased) {
        if (this.lease) phone11MediaOwnership.release(this.lease);
        this.mediaReleased = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.unsubscribeOwner?.();
        this.unsubscribeOwner = undefined;
        clearActiveNativeMeeting(this);
      }
      if (audioError) throw audioError;
    })();
    this.releaseTask = cleanup;
    try {
      await cleanup;
    } finally {
      // A rejected stop remains visible to this caller, but cleanup can retry
      // only the audio stop without resurrecting any meeting resources.
      if (this.releaseTask === cleanup) this.releaseTask = undefined;
    }
  }
}

/** Called before CallKit/SIP activation. No meeting media may survive this gate. */
export async function prepareSipMediaOwnership(callId: string): Promise<MediaLease> {
  const request = phone11MediaOwnership.requestSip(`sip:${callId}`);
  await request.ready;
  return request.lease;
}

export function releaseSipMediaOwnership(lease: MediaLease | undefined): void {
  if (lease) phone11MediaOwnership.release(lease);
}

/** Auth teardown must not leave a suspended prior-account meeting resumable. */
export function clearNativeMeetingMediaForAuth(): void {
  phone11MediaOwnership.clearForAuth();
}
