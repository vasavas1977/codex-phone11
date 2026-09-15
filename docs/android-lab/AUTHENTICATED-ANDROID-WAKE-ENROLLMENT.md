# Authenticated Android wake enrollment

The commissioned Android staging package can create an owned FCM wake binding only after all of these conditions hold:

1. The app signs in to a full Phone11 staging API through the HTTPS origin embedded in `phone11ApiBaseUrl`.
2. The authenticated user loads the enabled SIP account assigned to that same user and tenant.
3. The native Firebase adapter returns the current FCM registration token.
4. `push.register` records that token against the server-resolved session and current SIP assignment.
5. `push.enrollWake` creates a seven-day-or-shorter binding and returns its one-time grant.
6. Android stores the grant with Android Keystore AES-GCM and exposes only the public binding to JavaScript.
7. The shared Siprix engine adopts the public binding only after `push.resolveWakeBinding` revalidates it under the exact current session.

The client registers on authenticated Android startup and receives provider token rotations while the process is active. Foreground maintenance revalidates the binding every 15 minutes while the owned SIP account is registered and no call is active, renewing only when less than 24 hours remains. Token rotation registers the replacement before deleting the old token, and the database trigger advances the existing binding to the new push revision.

Logout stops token callbacks, clears the encrypted native grant, unregisters the current device when reachable, and then revokes the server session. The session foreign keys delete any remaining push device and wake binding even when local unregister cannot complete. Owner, tenant, SIP assignment, session replacement, expiry, and malformed binding changes all fail closed.

The Android lab screen reports only `bound` or `not bound` and the binding expiry. It does not expose the binding ID, session binding, device ID, user or tenant ID, grant, FCM token, or SIP credentials.

The private `phone11-fcm-staging-lab` Cloud Run service is the narrow scenario/attestation service and does not expose Phone11 sign-in or tRPC. It cannot create the binding by itself. A separate isolated deployment of the full Phone11 server entry point is required, with the auth, push, and wake migrations applied to an isolated staging database and an explicitly provisioned staging user/SIP assignment. Until that exists, the installed app can obtain an FCM token but cannot move from `not bound` to `bound`.
