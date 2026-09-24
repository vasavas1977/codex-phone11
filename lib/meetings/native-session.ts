import { Platform } from "react-native";

import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

import {
  BrowserMeetingConnectionFailure,
  BrowserMeetingSession,
  type BrowserRoom,
} from "./browser-session";
import {
  MeetingJoinFailure,
  safeMeetingJoinHttpStatus,
  type MeetingJoinDiagnostic,
  type MeetingJoinReason,
  type MeetingJoinStage,
} from "./join-failure";
import { MediaOwnershipCoordinator, type MediaLease } from "./media-ownership";
import { classifyRoomConstructionFailure } from "./room-construction-diagnostic";
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
  configureMeetingAudio: () => Promise<void>;
  startAudioSession: () => Promise<void>;
  stopAudioSession: () => Promise<void>;
  classifyJoinFailure: (
    error: unknown,
    stage: MeetingJoinStage,
  ) => MeetingJoinDiagnostic;
};

let bindingsPromise: Promise<NativeBindings> | undefined;
/** The one authority for SIP and meeting microphone/camera ownership. */
export const phone11MediaOwnership = new MediaOwnershipCoordinator();

function hasLiveSipCall() {
  const calls = useSipCallStore.getState();
  return (
    Boolean(
      calls.incomingCall && calls.incomingCall.status !== "disconnected",
    ) ||
    Object.values(calls.activeCalls).some(
      (call) => call.status !== "disconnected",
    )
  );
}

async function loadNativeBindings(): Promise<NativeBindings> {
  if (Platform.OS === "web")
    throw new Error("Meetings require the Phone11 mobile app.");
  if (!bindingsPromise) {
    bindingsPromise = Promise.all([
      import("@livekit/react-native"),
      import("livekit-client"),
    ])
      .then(([native, client]) => {
        if (
          typeof native.registerGlobals !== "function" ||
          typeof client.Room !== "function"
        ) {
          throw new Error("Meetings require a current Phone11 build.");
        }
        // Phone11 owns SIP and CallKit. Do not let the SDK automatically
        // configure the shared iOS audio session outside our lease boundary.
        native.registerGlobals({ autoConfigureAudioSession: false });
        return {
          Room: client.Room as unknown as NativeBindings["Room"],
          // expo-audio can leave the shared iOS session in playback mode. The
          // manually managed LiveKit session must restore duplex meeting audio
          // after acquiring the media lease and before activating it.
          configureMeetingAudio: Platform.OS === "ios"
            ? () => native.AudioSession.setAppleAudioConfiguration({
                audioCategory: "playAndRecord",
                audioCategoryOptions: [
                  "allowBluetooth",
                  "allowBluetoothA2DP",
                  "allowAirPlay",
                  "defaultToSpeaker",
                ],
                audioMode: "videoChat",
              })
            : async () => undefined,
          startAudioSession: native.AudioSession.startAudioSession,
          stopAudioSession: native.AudioSession.stopAudioSession,
          classifyJoinFailure: (error: unknown, stage: MeetingJoinStage) => {
            if (stage === "room_create") {
              return classifyRoomConstructionFailure(error, client.Room);
            }
            let candidate = error;
            for (let depth = 0; depth < 4; depth += 1) {
              if (candidate instanceof client.ConnectionError) {
                const reasons: Partial<Record<number, MeetingJoinReason>> = {
                  [client.ConnectionErrorReason.NotAllowed]: "not_allowed",
                  [client.ConnectionErrorReason.ServerUnreachable]:
                    "server_unreachable",
                  [client.ConnectionErrorReason.InternalError]: "internal",
                  [client.ConnectionErrorReason.Cancelled]: "cancelled",
                  [client.ConnectionErrorReason.LeaveRequest]: "server_leave",
                  [client.ConnectionErrorReason.Timeout]: "timeout",
                  [client.ConnectionErrorReason.WebSocket]: "websocket",
                  [client.ConnectionErrorReason.ServiceNotFound]:
                    "service_not_found",
                };
                return {
                  reason: reasons[candidate.reason],
                  httpStatus: safeMeetingJoinHttpStatus(candidate.status),
                };
              }
              if (
                !(candidate instanceof Error) ||
                candidate.cause === undefined
              )
                break;
              candidate = candidate.cause;
            }
            return {};
          },
        };
      })
      .catch((error) => {
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
  private audioStartAttempted = false;
  private audioSetupTask?: Promise<void>;
  private audioStopped = false;
  private roomStopped = false;
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
    if (!meetingId || hasLiveSipCall())
      throw new Error("Finish your Phone call before joining a meeting.");
    // A different account can never retain a process-global native room.
    let bindings: NativeBindings;
    try {
      const previous = getActiveNativeMeeting();
      if (previous) await previous.leave();
      bindings = await loadNativeBindings();
    } catch {
      throw new MeetingJoinFailure("bindings");
    }
    if (getAuthSnapshot().user?.id !== owner.id)
      throw new Error(
        "Your Phone11 account changed before the meeting could connect.",
      );
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
        // A stuck SDK publish/permission promise must not strand CallKit's
        // SIP preparation indefinitely. Timeout rejects the SIP handoff;
        // the meeting cleanup continues and the shared audio lease is never
        // released until its native media actually stops.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Meeting media did not stop before the Phone call.")),
            8000,
          );
        });
        return Promise.race([lifecycle.leave(), deadline]).finally(() => {
          if (timeout) clearTimeout(timeout);
        });
      },
    };
    // A user-initiated rejoin after SIP releases its lease is the coordinator's
    // explicit resume operation. It never resumes automatically or reuses a token.
    const request =
      phone11MediaOwnership.getSnapshot().interruptedMeetingId === meetingId
        ? phone11MediaOwnership.resumeMeeting(meetingId, hooks)
        : phone11MediaOwnership.requestMeeting(meetingId, hooks);
    lifecycle.lease = request.lease;
    lifecycle.unsubscribe = lifecycle.session.subscribe(() => {
      const status = lifecycle.session.getSnapshot().status;
      // An external SDK disconnect can arrive while a capture operation is
      // still publishing. Use the same tracked disconnect barrier as a user
      // leave before stopping audio or releasing the media lease.
      if (status === "disconnected" && !lifecycle.leaving)
        void lifecycle.leave().catch(() => undefined);
    });
    let stage: MeetingJoinStage = "audio_start";
    try {
      await request.ready;
      if (!lifecycle.ownerIsCurrent())
        throw new Error(
          "Your Phone11 account changed before the meeting could connect.",
        );
      if (hasLiveSipCall() || !phone11MediaOwnership.isCurrent(request.lease)) {
        throw new Error(
          "A Phone call started before the meeting could connect.",
        );
      }
      // Configuration and activation are one cleanup-owned operation. A SIP
      // arrival during either native call must wait for it to settle before
      // Phone media can take the shared iOS audio session.
      lifecycle.audioStartAttempted = true;
      const audioSetupTask = (async () => {
        await bindings.configureMeetingAudio();
        if (
          lifecycle.leaving ||
          !lifecycle.ownerIsCurrent() ||
          hasLiveSipCall() ||
          !phone11MediaOwnership.isCurrent(request.lease)
        ) throw new Error("Meeting audio setup was cancelled.");
        await bindings.startAudioSession();
      })();
      lifecycle.audioSetupTask = audioSetupTask;
      await audioSetupTask;
      if (
        !lifecycle.ownerIsCurrent() ||
        hasLiveSipCall() ||
        !phone11MediaOwnership.isCurrent(request.lease)
      ) {
        await lifecycle.leave().catch(() => undefined);
        throw new Error(
          "A Phone call started before the meeting audio could start.",
        );
      }
      stage = "signal_connect";
      await lifecycle.session.connect({
        url: admission.url,
        token: admission.token,
        microphone: preferences.microphone,
        camera: preferences.camera,
        receiveOnly: lifecycle.receiveOnly,
      });
      stage = "connected";
      if (
        !lifecycle.ownerIsCurrent() ||
        !phone11MediaOwnership.isCurrent(request.lease)
      )
        throw new Error("Meeting connection was cancelled.");
      // SIP can acquire the lease while native setup or room connection is
      // awaiting. Do not publish this room as active unless this exact meeting
      // still owns it.
      if (
        !lifecycle.ownerIsCurrent() ||
        hasLiveSipCall() ||
        !phone11MediaOwnership.isCurrent(request.lease)
      ) {
        await lifecycle.leave().catch(() => undefined);
        throw new Error(
          "A Phone call started before the meeting audio could start.",
        );
      }
      setActiveNativeMeeting(lifecycle);
      return lifecycle;
    } catch (error) {
      try { await lifecycle.leave(); }
      catch {
        // Keep failed cleanup addressable by the next join/auth teardown.
        // The held media lease prevents SIP from racing a live local track.
        setActiveNativeMeeting(lifecycle);
      }
      const failureStage =
        error instanceof BrowserMeetingConnectionFailure ? error.stage : stage;
      throw new MeetingJoinFailure(
        failureStage,
        bindings.classifyJoinFailure(error, failureStage),
        error,
      );
    }
  }

  /** Stop tracks and audio before making the SIP session eligible to own media. */
  async leave(): Promise<void> {
    this.leaving = true;
    try {
      await this.session.disconnect();
      this.roomStopped = true;
      await this.releaseAfterMediaStops();
    } catch (error) {
      // Failed LiveKit or native-audio teardown must retain the shared lease.
      // A later leave can retry instead of handing possibly live media to SIP.
      this.leaving = false;
      throw error;
    }
  }

  async releaseAfterMediaStops(): Promise<void> {
    if (!this.roomStopped)
      throw new Error("Meeting tracks have not stopped.");
    if (this.releaseTask) return this.releaseTask;
    const cleanup = (async () => {
      let audioError: unknown;
      // BrowserMeetingSession.disconnect(true) stops all local tracks first.
      // A failed native audio stop retains the media lease. A later leave
      // retries it before SIP can acquire the shared iOS audio session.
      // Native configuration/activation can outlive a SIP interruption. Wait
      // for that attempt before stopping and releasing the shared media lease.
      await this.audioSetupTask?.catch(() => undefined);
      if (this.bindings && this.audioStartAttempted && !this.audioStopped) {
        try {
          await this.bindings.stopAudioSession();
          this.audioStopped = true;
        } catch (error) {
          audioError = error;
        }
      }
      if (audioError) throw audioError;
      if (!this.mediaReleased) {
        if (this.lease) phone11MediaOwnership.release(this.lease);
        this.mediaReleased = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.unsubscribeOwner?.();
        this.unsubscribeOwner = undefined;
        clearActiveNativeMeeting(this);
      }
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
export async function prepareSipMediaOwnership(
  callId: string,
): Promise<MediaLease> {
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
