# Phone11 CallKit Audio Repair

## Observed Failure

Direct USB retrieval of the owner's Phone11 build 8 events at 12:59Z shows:

- Registration succeeds and renews with SIP 200.
- The 12:58:12Z call to the owner's destination ending 9422 receives 200 at
  12:58:20Z, enters CONNECTING, then terminates Not Acceptable with no media.
- Correlated FreeSWITCH A-leg UUID: b550c818-4c56-486d-a539-6910a68d0e3b.
- SIP Call-ID: YW2WfjzZ8Nfo1RhXnhLZW2L1Q77bszhk.
- FreeSWITCH receives BYE about 60 ms after answer, with zero app-leg media
  packets and zero answered seconds. This is not an unanswered carrier call.
- Another app call reached CONFIRMED, then reported audio activation failure
  -560577449, also with no active media.
- Live Kamailio already has separate WebRTC/native branches, unlike the older
  repository template. Its native answer logs show RTP/AVP with PCMU offered
  to the app. No live routing edits were made based on the stale template.

## Source Defect and Change

The app opened PJSIP's sound device at outgoing creation and again on confirmed
call events, but did not subscribe to CallKit audio activation/deactivation.
PJSIP native startup also allowed automatic sound-device opening during media
negotiation. This conflicts with the documented CallKit audio lifecycle:

- https://github.com/pjsip/pjproject/issues/1941
- https://docs.pjsip.org/en/latest/specific-guides/other/ios_push_notifications.html

Repair: keep the native sound device closed at startup, handle CallKit activation
and deactivation, serialize operations, ignore stale endpoint/activation work,
and avoid repeatedly reopening the device on call-state events. Reset sound
ownership on provider reset and endpoint cleanup. Add lifecycle diagnostics
without raw credentials or SDP keys.

This is a correction of an observed integration defect, not yet a claim that
all media negotiation or real-device audio failures are resolved.

## Verification

- 22 focused SIP/auth/native patch tests pass, including rapid audio interrupts,
  failed activation retry, stale endpoints, and native patch idempotency.
- 52 mobile auth client/UI tests pass.
- Native patch script parses and applies to the installed dependency; its new
  startup patch is idempotent and fails if the expected upstream anchor changes.
- Full repository tsc remains failing in transfer, marketing-site and backend
  areas; do not describe this as a clean full-repository type check.
- Owner approved building and installing a new signed iOS app using existing
  credentials. Build/install and audible handset call results remain pending.

No production server configuration, SIP credential, carrier route or billing
setting was changed. Raw handset logs remain outside Git with owner-only access.
