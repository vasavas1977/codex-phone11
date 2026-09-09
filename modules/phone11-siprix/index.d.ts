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

export interface Call {
  id: string;
  callId: string;
  accountId: string;
  direction: 'incoming' | 'outgoing';
  state: 'dialing' | 'ringing' | 'proceeding' | 'connected' | 'held' | 'terminated';
  remoteUri: string;
  hasVideo: false;
  muted: boolean;
  held: boolean;
  holdState: number;
  statusCode?: number;
}

export interface Snapshot {
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

type EventData =
  | { type: 'registration'; account: Account }
  | { type: 'callIncoming' | 'callProceeding' | 'callConnected' | 'callTerminated' | 'callHeld' | 'callMuted'; call: Call }
  | { type: 'devicesAudioChanged' | 'audioSession'; audioSessionActive: boolean; speaker: boolean }
  | { type: 'trial' }
  | { type: 'network'; networkState: number }
  | { type: 'dtmf'; callId: string; tone: number }
  | { type: 'error'; operation: string; code: number };

export type SiprixEvent = EventData & { generation: number; sequence: number };
export type SiprixAccount = Account;
export type SiprixCall = Call;
export type SiprixSnapshot = Snapshot;

/** Channel: Phone11SiprixEvent via new NativeEventEmitter(Phone11Siprix). */
export interface Phone11SiprixModule {
  initialize(options: Record<string, never>): Promise<Snapshot>;
  getSnapshot(): Promise<Snapshot>;
  createAccount(config: AccountConfig): Promise<Account>;
  registerAccount(accountId: string, expireTime: number): Promise<void>;
  unregisterAccount(accountId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  makeCall(accountId: string, destination: string): Promise<Call>;
  answerCall(callId: string): Promise<void>;
  hangupCall(callId: string): Promise<void>;
  setMute(callId: string, muted: boolean): Promise<void>;
  setHold(callId: string, held: boolean): Promise<void>;
  sendDtmf(callId: string, digits: string): Promise<void>;
  setSpeaker(enabled: boolean): Promise<void>;
  handleNativeAudioSession(active: boolean): Promise<void>;
  destroy(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

declare const Phone11Siprix: Phone11SiprixModule | undefined;
export default Phone11Siprix;
