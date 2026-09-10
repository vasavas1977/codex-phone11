# Backend security boundary changes

The legacy phone backend endpoints now deny requests unless their actual owner or configured integration is established.

- FreeSWITCH and Kamailio require configured, non-placeholder secrets of at least 24 characters. Only `x-fs-secret` / `x-kam-secret` headers are accepted; body/query credentials are no longer accepted. SHA-256 digests are compared with `timingSafeEqual`.
- Push call triggers require `PUSH_SHARED_SECRET` in `x-push-secret`. A normal authenticated user session does not grant permission to trigger another user's device.
- Push token registration resolves the caller's exact active `user_extensions` assignment, extension tenant, and SIP account. Removal only touches that user's device tokens. Delivery rechecks assignments and refuses ambiguous identities across tenants.
- Missing APNs/FCM configuration returns zero sent and an unavailable error. No simulated send increments or device token fragments are logged. Token storage remains in memory; durable token persistence and physical background-call delivery are still outstanding.
- Recording playback requires owned session authentication, an explicitly assigned extension on a call leg in the same tenant, and a file contained within that tenant's recording directory. Transcript analysis uses the same owner check.
- The current deployment has no recording/call-leg/voicemail storage tables, according to the root agent's live metadata check. Missing recording storage returns unavailable. Voicemail endpoints explicitly return unavailable without inventing storage or tenant defaults.
- Recording uploads require an authenticated integration, an explicit existing tenant/call record, and a bounded raw WAV body with `call_uuid` and `tenant_id` query metadata. Paths and tenant IDs are validated, files are exclusively created, and absolute storage paths are not returned.
- Internal extension and ordinary PSTN callback routing resolve the caller's active tenant using SIP username and domain. CDR callbacks reject absent tenant IDs instead of letting the legacy processor default to tenant 1.

## Deployment compatibility

Before activating these endpoints, callers must send the new required headers and explicit scope fields. This change does not configure credentials, create schemas, enable APNs/FCM, deploy server changes, or prove media storage. The signed mobile app must attach its authenticated session when requesting protected media; a bare playback URL is insufficient.

Focused verification: 29 passing tests across media security, push security, PBX callback security, and logout. Physical provider push delivery remains unverified. Broader repository TypeScript failures are tracked separately from these changed files.
