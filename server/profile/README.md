# Phone11 workspace profile status

`migration.sql` creates tenant-scoped manual availability, status text and work-location preferences. The app does not apply it at startup. Apply it only through the reviewed Phone11 database migration process.

The migration also creates `phone11_workspace_profile_status_settings`. No row means the feature is disabled. A workspace owner or administrator enables it through `profile.adminSettings` and `profile.setAdminEnabled`; the actor ID always comes from the authenticated session, and the write rechecks the active role in the same SQL statement. The latest actor and timestamp are stored with the tenant setting. Ordinary members cannot read or change the workspace setting.

The router authenticates the owner from the session and never accepts a target user ID for profile writes. A member can edit only their own profile. Reads require active membership for the caller and each returned colleague, and the setting is rechecked with each profile lookup. Missing schema and a disabled tenant both fail status reads/writes closed; Team Chat keeps its automatic presence when profile status is disabled. The notification repository applies DND only when the selected tenant is enabled, and rechecks the same condition at enqueue, claim, and immediately before provider contact. Disabling status retains user profile rows and suspends their visibility and DND effect. Re-enabling status makes still-unexpired saved values effective again.

## Migration and rollout

1. Select a clean reviewed release containing this router, tenant gate, admin screen, and DND dispatcher checks. Pin the migration source, catalog verifier, runtime images, protected probes, and operator manifest.
2. Use the rollout operator to replace the worker baseline while the old API candidate still serves traffic, then route tRPC to the new baseline. Replace the API candidate while traffic stays on that gated baseline. The feature settings table is still absent, so profile status remains unavailable during this bridge.
3. Apply the additive migration only after both new runtime receipts are pinned and public tRPC routes to the new baseline. Verify both profile tables, constraints, keys, owner, and effective database-role grants before writing the migration receipt. Do not alter or backfill profile rows or membership roles. The settings table starts empty, so every tenant remains disabled.
4. Route tRPC to the new candidate. The owner or administrator then opens `/admin/profile-status`, reviews the behavior, and explicitly enables the selected workspace. Verify that a member can update their own status and another tenant remains disabled. Do not treat source, schema, or route verification as live APNs/provider proof.

Rollback is forward-only at the database layer. Before the migration receipt exists, the old baseline can be restored through the guarded ordinary-alert rollback. After the receipt exists, use only the disabled-notification rollback for an old dispatcher; keep tRPC on the new gated baseline or candidate. Retain both tables and all user status rows, including when a tenant is disabled. Do not drop or truncate profile tables. Restore notifications only with the reviewed DND-aware dispatcher.

## Private profile photos

`photo-migration.sql` adds one versioned photo per user and workspace. Bytes use
the existing private `PHONE11_CHAT_MEDIA_PATH`; only metadata is stored in the
database. Apply the migration separately before enabling the UI capability.

The upload route authenticates and authorizes the active workspace before it
reads the bounded raw body. It accepts parsed JPEG, PNG, or WebP images up to
2 MiB and 2048 x 2048 pixels. PNG decompression runs asynchronously and is done
only on upload; authenticated reads verify the immutable content hash without
decoding the image again. Reads require both the viewer and target to remain
active Phone11 users in the selected workspace. The returned `photoUrl` is an
authenticated server-relative route with a version, never a client-supplied or
public storage URL. Responses use `private, no-store` so membership revocation
is enforced by the next request.

Retired photo keys are inserted into `phone11_profile_photo_deletions` in the
same transaction that changes metadata. The existing private-media retention
lifecycle retries physical deletion and performs a bounded, symlink-safe scan
for old unreferenced files left by a process failure before metadata commit.
