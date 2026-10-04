export interface AccountConfig {
  sipServer: string;
  sipExtension: string;
  sipPassword: string;
  sipAuthId?: string;
  sipProxy?: string;
  stunServer?: string;
  displName?: string;
  transport: 'UDP' | 'TCP' | 'TLS';
  port?: number;
  expireTime?: number;
  secureMedia?: 0 | 1 | 2;
  iceEnabled?: boolean;
  rtcpMuxEnabled?: boolean;
  rewriteContactIp?: boolean;
  verifyIncomingCall?: boolean;
  forceSipProxy?: boolean;
  aCodecs?: number[];
}

export interface Account {
  id: string;
  accountId: string;
  registrationState: 'unregistered' | 'registering' | 'registered' | 'failed';
  regState?: number;
  sipStatusCode?: number;
}

export interface WakeBinding {
  bindingId: string; ownerUserId: number; tenantId: number; deviceId: string; sessionBinding: string; expiresAt: number;
}
export interface NativeWake extends WakeBinding { v: 1; callUUID: string; grantExpiresAt: number; }

export type ConsultationPhase = "holding" | "held_ready" | "calling" | "ready" | "switching" | "restoring_audio" | "consultation_failed" | "canceling" | "returning" | "returned" | "return_failed" | "transferring" | "transfer_failed" | "completed";

export interface Call {
  id: string;
  callId: string;
  accountId: string;
  direction: 'incoming' | 'outgoing';
  state: 'dialing' | 'ringing' | 'proceeding' | 'connected' | 'held' | 'terminated';
  remoteUri: string;
  hasVideo: boolean;
  videoOffered?: boolean;
  cameraMuted?: boolean;
  muted: boolean;
  held: boolean;
  holdState: number;
  /** One SDK transfer invocation is permitted per native call lifetime. */
  transferAttempted?: boolean;
  transferRequestId?: string;
  transferPending?: boolean;
  transferStatusCode?: number;
  consultationAttempted?: boolean;
  consultationRequestId?: string;
  consultationCallId?: string;
  consultationParentId?: string;
  consultationDestination?: string;
  consultationPhase?: ConsultationPhase;
  statusCode?: number;
  historyId?: string; startedAt?: number; answeredAt?: number;
  wakeCallUUID?: string;
  wakeSystemAnswered?: boolean;
}

export interface Snapshot {
  /** Default-off native source gate; never inferred from JS method presence. */
  warmTransferAvailable?: boolean;
  nativeWake?: NativeWake;
  initialized: boolean;
  generation: number;
  sequence: number;
  sdkVersion: string | null;
  accounts: Account[];
  calls: Call[];
  audioSessionActive: boolean;
  speaker: boolean;
  trialNotified: boolean;
}

export interface PlaybackAudioRouteStatus {
  route: "speaker" | "earpiece" | "external" | "unknown";
  label: string;
}

type EventData =
  | { type: 'registration'; account: Account }
  | { type: 'callIncoming' | 'callProceeding' | 'callConnected' | 'callTerminated' | 'callHeld' | 'callMuted' | 'callTransferred' | 'callVideoChanged' | 'consultationChanged'; call: Call }
  | { type: 'devicesAudioChanged' | 'audioSession'; audioSessionActive: boolean; speaker: boolean }
  | ({ type: 'playbackAudioRoute' } & PlaybackAudioRouteStatus)
  | { type: 'trial' }
  | { type: 'network'; networkState: number }
  | { type: 'dtmf'; callId: string; tone: number }
  | { type: 'error'; operation: string; code: number };

export type SiprixEvent = EventData & { generation: number; sequence: number };
export type SiprixAccount = Account;
export type SiprixCall = Call;
export type SiprixSnapshot = Snapshot;

/** Channel: Phone11SiprixEvent via new NativeEventEmitter(Phone11Siprix). */
export interface CompletedWakeCall { id: string; ownerUserId: number; tenantId: number; number: string; direction: "inbound"; startedAt: number; answeredAt?: number; endedAt: number; updatedAt: number; }
export interface Phone11SiprixModule {
  readCompletedWakeCalls(binding: WakeBinding): Promise<CompletedWakeCall[]>;
  ackCompletedWakeCalls(binding: WakeBinding, ids: string[]): Promise<void>;
  bindForegroundWakeContext(binding: WakeBinding, sip: AccountConfig): Promise<void>;
  adoptIncomingWake(binding: WakeBinding, sip: AccountConfig): Promise<Snapshot>;
  restoreIncomingWakeDelegate(): Promise<void>;
  initialize(options: Record<string, never>): Promise<Snapshot>;
  getSnapshot(): Promise<Snapshot>;
  /** Atomically reserve the idle native runtime against incoming wake and new calls. */
  beginAccountChange?(): Promise<string>;
  /** Release a matching reservation; any queued CallKit wake resumes first. */
  endAccountChange?(token: string, config: AccountConfig | null, resumeWake: boolean): Promise<void>;
  createAccount(config: AccountConfig): Promise<Account>;
  registerAccount(accountId: string, expireTime: number): Promise<void>;
  unregisterAccount(accountId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  getVideoCapabilities?(): Promise<{ oneToOne: boolean; cameraMute: boolean; cameraSwitch: boolean; nativeView: boolean }>;
  requestCameraPermission?(): Promise<boolean>;
  makeVideoCall?(accountId: string, destination: string): Promise<Call>;
  /** Prepare explicit consent, then answer via the existing CallKit transaction. */
  prepareVideoAnswer?(callId: string): Promise<void>;
  cancelVideoAnswer?(callId: string): Promise<void>;
  setCameraMuted?(callId: string, muted: boolean): Promise<void>;
  switchCamera?(callId: string): Promise<void>;
  makeCall(accountId: string, destination: string): Promise<Call>;
  answerCall(callId: string): Promise<void>;
  hangupCall(callId: string): Promise<void>;
  /** Optional for compatibility with installed native builds predating transfer support. Resolves acceptance only. */
  createTransferRequestId?(): Promise<string>;
  transferCall?(callId: string, destination: string, requestId: string): Promise<void>;
  beginConsultation?(callId: string, destination: string, requestId: string): Promise<void>;
  continueConsultation?(callId: string, requestId: string): Promise<void>;
  cancelConsultation?(callId: string, requestId: string): Promise<void>;
  completeConsultation?(callId: string, requestId: string, transferRequestId: string): Promise<void>;
  setMute(callId: string, muted: boolean): Promise<void>;
  setHold(callId: string, held: boolean): Promise<void>;
  sendDtmf(callId: string, digits: string): Promise<void>;
  setSpeaker(enabled: boolean): Promise<void>;
  getPlaybackAudioRoute(): Promise<PlaybackAudioRouteStatus>;
  setPlaybackAudioRoute(route: "speaker" | "earpiece"): Promise<PlaybackAudioRouteStatus>;
  resetPlaybackAudioRoute(): Promise<PlaybackAudioRouteStatus>;
  handleNativeAudioSession(active: boolean): Promise<void>;
  destroy(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

declare const Phone11Siprix: Phone11SiprixModule | undefined;
export default Phone11Siprix;
