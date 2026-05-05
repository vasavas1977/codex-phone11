/**
 * Native Call Manager — CloudPhone11
 *
 * Integrates CallKit (iOS) and ConnectionService (Android) via react-native-callkeep.
 * This enables:
 *  - Incoming call UI on lock screen (full-screen call notification)
 *  - Call management from system call UI (answer, decline, end)
 *  - Audio route management (speaker, bluetooth)
 *  - Call history integration with native phone app
 *  - VoIP push notification handling for background call wake
 *
 * Architecture:
 *   VoIP Push (APNs/FCM) → NativeCallManager → CallKit/ConnectionService
 *                                            → SIP Engine (answer/decline)
 *                                            → Call Store (state sync)
 */

import { Platform, AppState, AppStateStatus } from "react-native";
import { sipEngine } from "./engine";
import { useSipCallStore, type SipCall } from "./call-store";

// CallKeep types
let RNCallKeep: any = null;

function getCallKeep() {
  if (Platform.OS === "web") return null;
  if (!RNCallKeep) {
    try {
      RNCallKeep = require("react-native-callkeep").default;
    } catch (e) {
      console.warn("[NativeCall] react-native-callkeep not available:", e);
    }
  }
  return RNCallKeep;
}

// UUID generator for call identifiers
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Map between PJSIP call IDs and CallKit UUIDs
const callIdToUuid: Map<string, string> = new Map();
const uuidToCallId: Map<string, string> = new Map();

class NativeCallManager {
  private initialized = false;
  private appStateSubscription: any = null;

  /**
   * Initialize CallKit (iOS) / ConnectionService (Android).
   * Must be called once on app start, after SIP engine initialization.
   */
  async initialize(): Promise<void> {
    const callKeep = getCallKeep();
    if (!callKeep) {
      console.log("[NativeCall] Not available on this platform");
      return;
    }

    try {
      // Configure CallKit / ConnectionService
      const options = {
        ios: {
          appName: "CloudPhone11",
          // Supported handle types
          includesCallsInRecents: true,
          maximumCallGroups: 2,
          maximumCallsPerCallGroup: 1,
          supportsVideo: true,
          // Audio session configuration
          audioSession: {
            categoryOptions: 0x01 | 0x04, // AllowBluetooth | AllowBluetoothA2DP
            mode: "voiceChat",
          },
          // Ringtone sound file (must be in app bundle)
          ringtoneSound: "ringtone.caf",
        },
        android: {
          alertTitle: "CloudPhone11 Permissions",
          alertDescription:
            "CloudPhone11 needs access to your phone accounts to manage calls",
          cancelButton: "Cancel",
          okButton: "OK",
          imageName: "phone_account_icon",
          // Self-managed ConnectionService for full control
          selfManaged: false,
          // Additional notification channel for incoming calls
          additionalPermissions: [],
          // Foreground service for active calls
          foregroundService: {
            channelId: "cloudphone11_calls",
            channelName: "CloudPhone11 Calls",
            notificationTitle: "CloudPhone11",
            notificationIcon: "ic_notification",
          },
        },
      };

      await callKeep.setup(options);

      // Register event listeners
      this._registerListeners(callKeep);

      // Monitor app state for background/foreground transitions
      this.appStateSubscription = AppState.addEventListener(
        "change",
        this._handleAppStateChange.bind(this)
      );

      // On Android, register the phone account
      if (Platform.OS === "android") {
        callKeep.setAvailable(true);
        callKeep.canMakeMultipleCalls(false);
      }

      this.initialized = true;
      console.log("[NativeCall] Initialized successfully");
    } catch (error) {
      console.error("[NativeCall] Initialization failed:", error);
    }
  }

  /**
   * Display incoming call on native UI (lock screen).
   * Called when SIP engine receives an incoming call.
   */
  displayIncomingCall(
    sipCallId: string,
    callerNumber: string,
    callerName?: string,
    hasVideo = false
  ): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = generateUUID();
    callIdToUuid.set(sipCallId, uuid);
    uuidToCallId.set(uuid, sipCallId);

    callKeep.displayIncomingCall(
      uuid,
      callerNumber,
      callerName || callerNumber,
      "generic", // handleType: "generic" | "number" | "email"
      hasVideo
    );

    console.log(
      `[NativeCall] Displaying incoming call: ${callerName || callerNumber} (UUID: ${uuid})`
    );
  }

  /**
   * Report that an outgoing call has started.
   * Called when user initiates a call from the app.
   */
  reportOutgoingCall(
    sipCallId: string,
    callerNumber: string,
    callerName?: string,
    hasVideo = false
  ): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = generateUUID();
    callIdToUuid.set(sipCallId, uuid);
    uuidToCallId.set(uuid, sipCallId);

    callKeep.startCall(
      uuid,
      callerNumber,
      callerName || callerNumber,
      "generic",
      hasVideo
    );

    console.log(
      `[NativeCall] Reporting outgoing call: ${callerNumber} (UUID: ${uuid})`
    );
  }

  /**
   * Report that a call has been connected (media flowing).
   */
  reportCallConnected(sipCallId: string): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    callKeep.setCurrentCallActive(uuid);
    console.log(`[NativeCall] Call connected: ${uuid}`);
  }

  /**
   * Report that a call has ended.
   */
  reportCallEnded(sipCallId: string, reason?: string): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    // Map reason to CallKit end reason
    const endReason = this._mapEndReason(reason);
    callKeep.reportEndCallWithUUID(uuid, endReason);

    // Clean up mappings
    callIdToUuid.delete(sipCallId);
    uuidToCallId.delete(uuid);

    console.log(`[NativeCall] Call ended: ${uuid} (reason: ${endReason})`);
  }

  /**
   * Update mute state in native call UI.
   */
  setMuted(sipCallId: string, muted: boolean): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    callKeep.setMutedCall(uuid, muted);
  }

  /**
   * Update hold state in native call UI.
   */
  setOnHold(sipCallId: string, held: boolean): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    callKeep.setOnHold(uuid, held);
  }

  /**
   * Send DTMF tone through native call UI.
   */
  sendDTMF(sipCallId: string, digit: string): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    callKeep.sendDTMF(uuid, digit);
  }

  /**
   * Clean up and destroy native call manager.
   */
  destroy(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // End all active calls in CallKit
    const callKeep = getCallKeep();
    if (callKeep && this.initialized) {
      callKeep.endAllCalls();
    }

    callIdToUuid.clear();
    uuidToCallId.clear();
    this.initialized = false;
  }

  // ─── Private Methods ──────────────────────────────────────────────

  private _registerListeners(callKeep: any): void {
    // User answered call from native UI (lock screen / notification)
    callKeep.addEventListener("answerCall", async ({ callUUID }: any) => {
      const sipCallId = uuidToCallId.get(callUUID);
      if (!sipCallId) return;

      console.log(`[NativeCall] User answered call from native UI: ${callUUID}`);
      await sipEngine.answerCall(sipCallId);
      callKeep.setCurrentCallActive(callUUID);
    });

    // User declined call from native UI
    callKeep.addEventListener("endCall", async ({ callUUID }: any) => {
      const sipCallId = uuidToCallId.get(callUUID);
      if (!sipCallId) return;

      console.log(`[NativeCall] User ended call from native UI: ${callUUID}`);
      await sipEngine.hangupCall(sipCallId);
      useSipCallStore.getState().terminateCall(sipCallId);

      callIdToUuid.delete(sipCallId);
      uuidToCallId.delete(callUUID);
    });

    // User toggled mute from native UI
    callKeep.addEventListener(
      "didToggleHoldCallAction",
      async ({ callUUID, hold }: any) => {
        const sipCallId = uuidToCallId.get(callUUID);
        if (!sipCallId) return;

        console.log(`[NativeCall] Hold toggled: ${hold}`);
        await sipEngine.setHold(sipCallId, hold);
        useSipCallStore.getState().setHeld(sipCallId, hold);
      }
    );

    // User toggled mute from native UI
    callKeep.addEventListener(
      "didPerformSetMutedCallAction",
      async ({ callUUID, muted }: any) => {
        const sipCallId = uuidToCallId.get(callUUID);
        if (!sipCallId) return;

        console.log(`[NativeCall] Mute toggled: ${muted}`);
        await sipEngine.setMute(sipCallId, muted);
        useSipCallStore.getState().setMuted(sipCallId, muted);
      }
    );

    // User sent DTMF from native UI
    callKeep.addEventListener(
      "didPerformDTMFAction",
      async ({ callUUID, digits }: any) => {
        const sipCallId = uuidToCallId.get(callUUID);
        if (!sipCallId) return;

        console.log(`[NativeCall] DTMF: ${digits}`);
        await sipEngine.sendDtmf(sipCallId, digits);
      }
    );

    // Audio route changed (speaker, bluetooth, etc.)
    callKeep.addEventListener(
      "didChangeAudioRoute",
      ({ output, reason }: any) => {
        console.log(`[NativeCall] Audio route changed: ${output} (${reason})`);
      }
    );

    // VoIP push notification received (iOS only)
    // This is critical for waking the app when a call comes in while app is killed
    if (Platform.OS === "ios") {
      callKeep.addEventListener(
        "didReceiveStartCallAction",
        async ({ callUUID, handle, name }: any) => {
          console.log(`[NativeCall] Start call action: ${handle}`);
          // This is triggered when user taps "Call Back" from native call history
          if (handle) {
            const callId = await sipEngine.makeCall(handle);
            if (callId) {
              callIdToUuid.set(callId, callUUID);
              uuidToCallId.set(callUUID, callId);
            }
          }
        }
      );

      // Provider reset (iOS) — clean up all calls
      callKeep.addEventListener("didResetProvider", () => {
        console.log("[NativeCall] Provider reset — ending all calls");
        callIdToUuid.clear();
        uuidToCallId.clear();
      });
    }

    // Check reachability (Android) — verify phone account is still active
    if (Platform.OS === "android") {
      callKeep.addEventListener("checkReachability", () => {
        callKeep.setReachable();
      });
    }
  }

  private _handleAppStateChange(state: AppStateStatus): void {
    // When app comes to foreground, ensure call state is synced
    if (state === "active") {
      const { activeCalls, incomingCall } = useSipCallStore.getState();

      // Sync any active calls with native UI
      Object.values(activeCalls).forEach((call: SipCall) => {
        const uuid = callIdToUuid.get(call.id);
        if (uuid && call.status === "active") {
          const callKeep = getCallKeep();
          if (callKeep) callKeep.setCurrentCallActive(uuid);
        }
      });
    }
  }

  private _mapEndReason(reason?: string): number {
    // CallKit CXCallEndedReason values:
    // 1 = Failed, 2 = RemoteEnded, 3 = Unanswered, 4 = AnsweredElsewhere, 5 = DeclinedElsewhere
    if (!reason) return 2; // RemoteEnded
    const lower = reason.toLowerCase();
    if (lower.includes("busy")) return 2;
    if (lower.includes("reject") || lower.includes("decline")) return 2;
    if (lower.includes("timeout") || lower.includes("no answer")) return 3;
    if (lower.includes("elsewhere")) return 4;
    if (lower.includes("error") || lower.includes("fail")) return 1;
    return 2;
  }
}

// Singleton instance
export const nativeCallManager = new NativeCallManager();

/**
 * VoIP Push Notification Handler
 *
 * On iOS, VoIP pushes wake the app and must immediately display a CallKit UI.
 * On Android, FCM high-priority messages trigger the foreground service.
 *
 * Usage in your push notification handler:
 *   import { handleVoipPush } from "@/lib/sip/native-call";
 *   handleVoipPush(payload);
 */
export function handleVoipPush(payload: {
  callId: string;
  callerNumber: string;
  callerName?: string;
  hasVideo?: boolean;
}): void {
  console.log("[NativeCall] VoIP push received:", payload);

  // Immediately display incoming call UI
  // This MUST happen within 3 seconds on iOS or the app will be terminated
  nativeCallManager.displayIncomingCall(
    payload.callId,
    payload.callerNumber,
    payload.callerName,
    payload.hasVideo ?? false
  );
}

/**
 * iOS VoIP Push Registration
 *
 * Register for VoIP pushes on iOS to receive incoming call notifications
 * even when the app is killed. The push token must be sent to your
 * Flexisip push gateway or custom push server.
 *
 * This is called automatically by the SIP provider on initialization.
 */
export async function registerVoipPush(): Promise<string | null> {
  if (Platform.OS !== "ios") return null;

  try {
    const callKeep = getCallKeep();
    if (!callKeep) return null;

    // Request VoIP push permission and get token
    // The token is returned via the "didLoadWithEvents" callback
    // You must send this token to your Flexisip push gateway
    console.log("[NativeCall] Requesting VoIP push registration...");

    // Note: In production, use PushKit directly via a native module
    // or use expo-notifications with the VoIP push category
    return null;
  } catch (error) {
    console.error("[NativeCall] VoIP push registration failed:", error);
    return null;
  }
}
