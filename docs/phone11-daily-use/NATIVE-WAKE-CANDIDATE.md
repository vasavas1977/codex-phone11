# Native incoming wake candidate — disabled

This candidate joins the PushKit bootstrap, the existing CallKeep provider, the existing Siprix runtime and an authenticated server pending-call contract. It is source/test work, not evidence that a locked or terminated Phone11 app rings. `PHONE11_VOIP_WAKE_COMMISSIONED` remains `0`; native `closedAppCalling` stays false. No live push provider, PBX route or entitlement is commissioned by this change.

## Native path

The Swift AppDelegate plugin invokes `Phone11VoipPush.bootstrap()` before constructing the React bridge. The process-owned `P11VoipRegistry` survives bridge invalidation; a shipping gate of zero allocates no registry. Incoming callbacks first report a generic call through RNCallKeep's one existing provider. Invalid/expired deliveries use an isolated UUID and fail truthfully; a rejected/duplicate UUID is never used to end an unrelated call.

The native coordinator reserves one pending UUID before asynchronous CallKit completion. It then reads the limited device grant, checks the payload's binding, and claims the call over a fixed HTTPS origin. Redirects, cookies and credential-store reuse are disabled. Request/resource timeouts are five seconds; setup ends within the push's maximum 30-second lifetime. A delayed claim, SDK callback, timer or report completion cannot revive a cleared generation.

The SDK facade registers or resumes the existing runtime and signals actual registration success. `/ready` permits the server's held INVITE to continue. Only an exact `X-Phone11-Wake-ID` match may become the pre-reported CallKit UUID. The coordinator retains an early Answer, configures the audio category without activating it, accepts only the matching SDK call, and fulfills Answer only on SDK `connected`. Audio activation/deactivation forwards to the same runtime and ordinary provider callbacks still reach RNCallKeep.

After actual SDK connection, `/ready` renews a separate server busy lease every 20 seconds. It does not extend the original claim/SIP-configuration deadline. Transient heartbeat failure leaves the actual SIP call running; a definitive 401/403 ends only that wake and deletes its limited grant. SDK termination, local End, provider reset and setup expiry close the matching lease with best-effort `/end`. Server expiry is the fallback if the device is offline.

## Identity and credentials

Authenticated enrollment follows successful push-device registration and returns `bindingId`, `ownerUserId`, `tenantId`, `deviceId`, non-authenticating `sessionBinding`, grant expiry and a 32-byte opaque grant. The server stores the grant hash and binds it to the exact current auth session, assignment, device and push revision. Existing bindings are resolved before enrollment is retried, preserving a grant used by an active call.

Only this new incoming-wake grant item uses `AfterFirstUnlockThisDeviceOnly`. Existing auth bearer, SIP password, device ID and revocation ledger retain `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Before the first unlock after reboot, unavailable grant data fails the call. The grant is never returned by `getWakeBinding`, included in diagnostics, or stored in the SIP snapshot. The native HTTPS claim temporarily receives authorized SIP configuration in memory.

**Residual credential risk:** a full SIP password, once retrieved by a valid device, remains usable until PBX credential rotation. Revoking a wake grant/session prevents later claims but cannot revoke a password already obtained. Production commissioning must explicitly accept that device-trust boundary or implement ephemeral/per-device SIP credentials. The candidate does not silently claim that scoped HTTP authorization makes the underlying SIP password call-scoped.

JS adoption first resolves the stored nonsecret native binding using the exact currently authenticated bearer. Owner/tenant equality alone is insufficient: a new login by the same user cannot adopt a previous session's wake. The SDK facade must also validate the account configuration and existing runtime lease. CallKeep setup must restore the native forwarding delegate after setup resets its delegate.

## Protocol

- Push: top-level `{v:1, callUUID, bindingId, expiresAt}` plus APNs `aps`; no SIP secret, bearer, caller URI or routing address.
- Enrollment: authenticated `push.enrollWake({deviceId, platform:'ios'})`; `push.resolveWakeBinding({bindingId})` returns nonsecret identity or null for a missing/revoked/different-session binding.
- Native POST `/api/phone11/wake/claim|ready|status|end`: `Authorization: Wake <opaque grant>`, JSON `{callUUID,bindingId}`. Origin is baked into native `Phone11WakeOrigin`, never supplied by the notification.
- Claim: version/UUID/binding/identity/setup expiry, status `pending` or `ready`, and the existing Siprix account configuration fields. Native must still wait for real registration and an INVITE with the matching header; `ready` does not mean connected.
- Server `busy_until` is separate from setup expiry. An already-ready connected call may renew its busy lease; an expired claim cannot retrieve credentials again.

## Validation and remaining proof

Host tests execute the actual Objective-C coordinator with fake CallKit/SDK/storage/HTTP dependencies. They cover report-before-keychain/network, early/deferred Answer, duplicate UUID, reservation while CallKit is pending, logout and late completion, setup timer, connected-call timer immunity, category failure, authorization rejection, and ordinary call forwarding. Separate tests exercise the actual process-owned registry with the gate both off/on, session-bound JS adoption races, a hung native lookup, and idempotent Swift bootstrap transformation.

These tests do not prove iOS background execution, signed entitlements, APNs delivery, SDK registration from a cold process, media or provider policy compliance. Required final proof remains an exact signed candidate, provider commissioning, a real held-INVITE server hook and physical locked/background/terminated-app calls covering ring, Answer, two-way audio, End, remote cancel, duplicate push and owner logout. Before-first-unlock and user force-quit behavior must be recorded separately rather than promised from ordinary background success.

Apple requires immediate CallKit reporting and deferring Answer fulfillment until the service connection is ready. It also recommends reporting remote cancellation over the established service connection, not a second VoIP push. [Apple PushKit guidance](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit). The new keychain item's accessibility follows Apple's background-use guidance while retaining a device-only item. [Apple keychain accessibility](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly).
