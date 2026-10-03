# Phone11 contacts and enterprise sync readiness

Status: source boundary reviewed on 16 September 2026. This is not evidence of
an enterprise CRM, device-contact upload, or a production directory sync.

## Current Phone11 behaviour

- **Phone contacts** are read only after the owner grants iOS or Android
  Contacts permission. The app holds the normalized name and callable numbers
  in memory only, clears them on background/unmount, and never sends them to a
  Phone11 server or workspace.
- **Team** is an explicit, separate source. It retrieves only the signed-in
  member's active tenant directory through the protected chat directory route:
  user ID, display name, and an active extension. It does not return SIP
  credentials, contact notes, device address-book data, or simulated presence.
- The Team directory is not requested or retained while the user is on the
  private Phone contacts source. A refresh failure retains the last authorized
  snapshot only for the same account and workspace; account/workspace changes
  start empty.

## Required before enterprise contact synchronization

1. A canonical tenant contact service with a documented identifier, ownership,
   visibility, deletion, and audit contract. Phone11 must be an adapter, not a
   second CRM.
2. Explicit per-user consent and a purpose-limited import flow before any
   device address-book upload. The server must not treat app permission as
   authorization to copy contacts into an employer tenant.
3. Tenant-scoped create/update/delete APIs with role checks, idempotency,
   conflict handling, and a stable revision/cursor for offline reconciliation.
4. A privacy review covering number normalization, data retention, exports,
   erasure, audit access, and mappings between Phone11 and Super Number.
5. Authenticated multi-tenant acceptance: a contact in tenant A must never be
   searchable, callable by bare extension, or synchronized into tenant B.

Until those gates are complete, Phone11 supports private on-device contacts
and a safe tenant directory only. It must not advertise "contact sync".
