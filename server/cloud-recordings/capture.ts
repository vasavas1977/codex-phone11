/** PBX-only capture orchestration. Never pass mobile event fields as trusted identity.
 * Deployment must supply a durable, transactional ledger and authenticated ESL.
 * No listener is registered and no capture is enabled merely by importing this file.
 */
export type CaptureIdentity = { callUuid: string; channelUuid: string; tenantId: number; extensionId: number };
export type CaptureRequest = { kind: 'automatic' } | { kind: 'manual'; actorUserId: number };
export type CaptureLease = CaptureIdentity & { token: string; path: string; uploadLeaseToken?: string; storageKey?:string };
export interface CaptureLedger {
  /** Resolve exact persisted call-leg mapping; enforce current admin policy and,
   * for manual requests, current actor membership + assigned extension permission.
   * Atomically claim once per call; duplicate/revoked/ambiguous requests return null.
   */
  reserve(channelUuid: string, request: CaptureRequest): Promise<CaptureLease | null>;
  /** Recheck same identity, policy and reservation after announcement. */
  permitted(lease: CaptureLease): Promise<boolean>;
  started(lease: CaptureLease): Promise<void>;
  failed(lease: CaptureLease, reason: 'announcement_failed' | 'capture_failed' | 'policy_revoked'): Promise<void>;
  /** Durable exclusive completion lease. Require exact authenticated RECORD_STOP
   * channel/path and previously started authorization. Retries return same token;
   * concurrent/already finalized completions return null. No number/time matching.
   */
  complete(channelUuid: string, path: string): Promise<CaptureLease | null>;
  uploaded(lease: CaptureLease, storageKey: string): Promise<void>;
  cleaned(lease:CaptureLease):Promise<void>;
  releaseCompletion(lease: CaptureLease): Promise<void>;
  active(channelUuid: string, actorUserId: number): Promise<CaptureLease | null>;
}
/** Native duration protection only, not an aggregate storage quota.
 * Confirm actual PCM16/stereo/16kHz output on the commissioned FreeSWITCH build
 * before relying on the ~76.8MB estimate. Missing stop events after reconnect
 * retain durable reconciliation until channel end; unattended readiness needs
 * separate free-space/quota and real media acceptance.
 * https://developer.signalwire.com/freeswitch/media-and-codecs/audio-files/
 */
export const RECORDING_MAX_SECONDS = 1200;
export const RECORDING_SAMPLE_RATE = 16000;
export interface CaptureTransport {
  api(command: string): Promise<string>;
  /** Subscribe before starting; retain exact stop observation after start ACK. */
  startRecording(lease: CaptureLease, limitSeconds: number, onStopped: () => Promise<void>): Promise<void>;
  /** Must resolve only after authenticated PLAYBACK_STOP on BOTH exact legs.
   * A +OK enqueue response is not announcement completion. */
  announceBoth(lease: CaptureLease): Promise<void>;
}
export interface CaptureUpload {
  /** Read only this completed private regular WAV, bounded, NOFOLLOW; atomically
   * store by token and return the same storage key on retry, never overwrite. */
  prepareCapture(lease:CaptureLease):Promise<void>;
  putCompleted(lease: CaptureLease): Promise<string>;
  discardCompleted(lease:CaptureLease):Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const token = /^[a-zA-Z0-9_-]{1,128}$/;
function validate(lease: CaptureLease, channelUuid: string) {
  if (!uuid.test(channelUuid) || lease.channelUuid !== channelUuid || !token.test(lease.callUuid) || !uuid.test(lease.token)
      || !Number.isSafeInteger(lease.tenantId) || lease.tenantId <= 0 || !Number.isSafeInteger(lease.extensionId) || lease.extensionId <= 0
      || lease.path !== `/var/lib/freeswitch/recordings/phone11/${lease.tenantId}/${lease.token}.wav`) throw new Error('Invalid capture identity');
}
export function createRecordingCapture(deps: { ledger: CaptureLedger; transport: CaptureTransport; upload: CaptureUpload; enabled?: () => boolean }) {
  const enabled = deps.enabled ?? (() => process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === 'true');
  async function api(command: string) {
    const result = await deps.transport.api(command);
    if (!/^\+OK(?:\s|$)/.test(result)) throw new Error('Recording command failed');
  }
  return {
    async start(channelUuid: string, request: CaptureRequest): Promise<boolean> {
      if (!enabled() || !uuid.test(channelUuid)) return false;
      if (request.kind === 'manual' && (!Number.isSafeInteger(request.actorUserId) || request.actorUserId <= 0)) return false;
      const lease = await deps.ledger.reserve(channelUuid, request);
      if (!lease) return false;
      validate(lease, channelUuid);
      try { await deps.upload.prepareCapture(lease); await deps.transport.announceBoth(lease); }
      catch { await deps.ledger.failed(lease, 'announcement_failed'); return false; }
      if (!enabled() || !await deps.ledger.permitted(lease)) {
        await deps.ledger.failed(lease, 'policy_revoked'); return false;
      }
      try {
        // Stereo records both read/write directions; one recorder on the anchored
        // bridged session avoids duplicate files for its two channel UUIDs.
        await api(`uuid_setvar ${channelUuid} RECORD_STEREO true`);
        await api(`uuid_setvar ${channelUuid} RECORD_READ_ONLY false`);
        await api(`uuid_setvar ${channelUuid} RECORD_WRITE_ONLY false`);
        await api(`uuid_setvar ${channelUuid} record_sample_rate ${RECORDING_SAMPLE_RATE}`);
        await api(`uuid_setvar ${channelUuid} RECORD_HANGUP_ON_ERROR false`);
        // Native timer ends only recording, even if this process becomes unavailable.
        // PCM16 stereo at 16kHz uses ~76.8MB for 20min; this is not a disk quota.
        let releaseStarted!: () => void;
        const started = new Promise<void>(resolve => { releaseStarted = resolve; });
        let persisted = false;
        try {
          await deps.transport.startRecording(lease, RECORDING_MAX_SECONDS, async () => {
            await started;
            if (persisted) await finishRecording(channelUuid, lease.path);
          });
          await deps.ledger.started(lease); persisted = true;
        } finally { releaseStarted(); }
        return true;
      } catch {
        // A command timeout may still have attached the recorder. Best-effort
        // stop its exact private path; never hang up or destroy the live call.
        try { await api(`uuid_record ${channelUuid} stop ${lease.path}`); } catch { /* Ledger preserves failure for reconciliation. */ }
        // Keep the exact token pending/recording until the reconciler verifies
        // channel end and removes local files; a stop ACK is not completion.
        return false;
      }
    },
    async stop(channelUuid: string, actorUserId: number): Promise<boolean> {
      if (!uuid.test(channelUuid) || !Number.isSafeInteger(actorUserId) || actorUserId <= 0) return false;
      // Stop remains available after capture is disabled. Ledger checks actor.
      const lease = await deps.ledger.active(channelUuid, actorUserId);
      if (!lease) return false;
      validate(lease, channelUuid);
      await api(`uuid_record ${channelUuid} stop ${lease.path}`);
      return true; // Upload waits for actual RECORD_STOP, never this command ACK.
    },
    recordingStopped: finishRecording,
  };
  async function finishRecording(channelUuid: string, path: string): Promise<boolean> {
      if (!uuid.test(channelUuid)) return false;
      const lease = await deps.ledger.complete(channelUuid, path);
      if (!lease) return false;
      validate(lease, channelUuid);
      if (lease.path !== path) throw new Error('Recording identity changed');
      try {
        const storageKey = lease.storageKey ?? await deps.upload.putCompleted(lease);
        await deps.ledger.uploaded(lease, storageKey);
        await deps.upload.discardCompleted(lease);
        await deps.ledger.cleaned(lease);
        return true;
      } catch (error) { await deps.ledger.releaseCompletion(lease); throw error; }

}
}
