# Phone11 calling capability implementation — 15 September 2026

This document concerns Phone11's pinned Siprix iOS bridge only. Existing voice calling, RNCallKeep ownership, SDK version 1.0.40, account identity, and single-call limits remain in place.

## Blind transfer implemented in source

`Phone11Siprix.transferCall(callId, destination, requestId)` accepts a connected, unheld call and an extension/phone-number destination. The native method resolves only command acceptance. It records `transferPending` on the call, rejects duplicate commands, and emits `callTransferred` with `transferStatusCode` when the SDK responds. Each request uses a native NSUUID minted by `createTransferRequestId`, remaining unique across JS reloads without adding a crypto dependency. Snapshot reconciliation retains that outcome with its request ID, so a retained outcome from an earlier attempt cannot settle a retry. A success callback prevents another request while the SDK finishes ending the original call. No application hangup is issued.

`SiprixEngine.transferCall` waits for the outcome separately from the command queue. Mute and end-call commands remain usable while transfer is pending. Hold changes are rejected until transfer resolves, preventing conflicting hold/transfer state. Outcome code 0 confirms success. Other codes fail without ending the original call. Call termination without a success callback is not presented as a successful transfer. The wait expires after 30 seconds with an explicitly uncertain result; the native pending guard remains in force until the SDK resolves the operation, so timeout does not imply cancellation or trigger an automatic retry. A timed-out command that has not yet reached the SDK is not sent later. Session changes reject the pending result, and generation/account/call checks reject stale outcomes.

The module declaration is optional for compatibility with older installed builds. `SiprixEngine.supportsBlindTransfer()` must be true before exposing an actionable transfer button. The existing disabled transfer screen remains gated until native packaging and provider acceptance are verified. Do not route this through `lib/transfer/engine.ts`: its legacy/demo flow marks command acceptance as completed and is not a callback-confirmed Siprix implementation.

The first release accepts numeric extension/phone numbers with optional leading + and * or #; it deliberately does not accept arbitrary SIP URIs or headers. No target or credentials are included in transfer diagnostics.

### Required handset/provider acceptance

1. Transfer a connected inbound call to a reachable extension; verify target answers, remaining parties hear each other, and original device ends only after provider success.
2. Repeat outbound, denied destination, busy/unreachable destination, and user hangup during pending transfer. A held call or pending hold change must reject transfer until the unhold callback confirms resumed audio.
3. Confirm microphone mute and End remain responsive during pending transfer; decline/failure retains original call audio.
4. Confirm recording/session correlation across transfer: original recording finalizes, ownership remains scoped, and any new leg follows workspace recording policy with announcement. Do not assume SIP REFER preserves the existing recording/control ID.
5. Confirm a stalled/late callback is shown as uncertain after 30 seconds without duplicate REFER; restore native snapshot after app foregrounding.
6. Confirm account logout and old generation callbacks cannot settle another session's request.

Source/mock tests cannot prove PBX REFER acceptance or handset audio. This change has not been deployed or installed by this workstream.

## Video implementation requirements

Current source disables video in SDK initialization (`enableVideoCall = NO`), invite/answer flags, JS adapter admission, and the public call type. Video route is an unavailable screen; incoming upgrade callbacks are discarded. A visual screen alone is insufficient.

Implement in this order:

1. Add explicit capability negotiation by native build and platform. Add account video codec options and manual incoming upgrade policy. Request camera permission only when the user initiates or accepts video; continue audio on denial.
2. Add SDK createVideoWindow/callSetVideoWindow-backed native view managers for remote video and local preview, attach/detach with call identity and runtime generation. Detach before view destruction; do not reuse the same renderer for two calls.
3. Add invite/answer video flags, camera mute, camera switch, upgrade/accept events and snapshot state. Mark video active only on SDK confirmation. Preserve RNCallKeep as sole OS call provider.
4. Use the approved dark call stage with remote view, movable self preview, visible microphone/camera/audio controls, More, and an always-visible red End control. Show actual receiver/speaker/Bluetooth outputs, not invented devices.
5. Test permission denial, remote audio-only endpoint, upgrade rejection, camera off/on, foreground/background, screen lock, Bluetooth changes, Wi-Fi/cellular roaming, and hangup. Assert camera stops when video ends.

## Audio conference and attended transfer requirements

The bridge and JS engine both reject second calls today. The SDK exposes `mixerSwitchCall`, `mixerMakeConference`, and `callTransferAttended`; simply lifting the guard would cause existing adapter logic to hang up extra calls. First implement multi-call ownership, switched-call callback state, per-leg hold/mute, consultation cancellation, CallKeep grouping, and ending one leg versus all legs.

Build attended transfer over two verified native calls. Hold original, consult target, confirm transfer explicitly, and retain/resume original on failed consultation or cancellation. Do not reuse raw PJSIP `xferReplaces` wrappers for Siprix.

SDK mixer conference mixes audio locally. It does not distribute participant video. A Zoom-style group video grid requires a verified PBX video MCU or other video conference service, tenant-scoped room/session membership, participant events, recording rules, and native rendering. Repository FreeSWITCH conference sample XML is not evidence that a live tenant-safe video conference service is configured.

Conference UI should distinguish Add participant, merge, participant list, leave, and end for everyone according to actual server ownership. Avoid presenting a fake group video grid as a live feature.

## Official references inspected

- [Siprix API reference](https://docs.siprix-voip.com/rst/api.html): blind/attended REFER callbacks, video upgrade/window functions, mixer behavior, and call-switching events.
- Pinned local native selectors: `modules/phone11-siprix/vendor/siprix.xcframework/ios-arm64/siprix.framework/Headers/Siprix.h` — `callTransferBlind:toExt:`, `callTransferAttended:toCallId:`, `callUpgradeToVideo:`, `callSetVideoWindow:view:`, `createVideoWindow`, `mixerSwitchCall:`, and `mixerMakeConference`.

Keep SDK upgrades a separate verified change; no Flutter migration or SDK version change is required to begin these native capabilities.
