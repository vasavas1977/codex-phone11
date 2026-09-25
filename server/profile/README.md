# Phone11 workspace profile status

`migration.sql` creates tenant-scoped manual availability, status text and work-location preferences. The app does not apply it at startup. Apply it only through the reviewed Phone11 database migration process.

The migration also creates `phone11_workspace_profile_status_settings`. No row means the feature is disabled. A workspace owner or administrator enables status-only availability, status text, and work location through `profile.adminSettings` and `profile.setAdminEnabled`; the actor ID always comes from the authenticated session, and the write rechecks the active role in the same SQL statement. The latest actor and timestamp are stored with the tenant setting. Ordinary members cannot read or change the workspace setting. The separate `dnd_enabled` column defaults to false, is read-only to the admin API, and is reset to false when status is disabled.

The router authenticates the owner from the session and never accepts a target user ID for profile writes. A member can edit only their own profile. Reads require active membership for the caller and each returned colleague, and the setting is rechecked with each profile lookup. Missing schema and a disabled tenant both fail status reads/writes closed; Team Chat keeps its automatic presence when profile status is disabled. With `enabled=true` and `dnd_enabled=false`, historical DND rows are masked from profile and presence reads, new DND selections fail in the same guarded SQL as the write, and ordinary Team Chat alerts continue at enqueue, claim, and immediately before provider contact. Disabling status retains user profile rows, suspends their visibility, and resets `dnd_enabled`; re-enabling status does not re-enable DND.

## Migration and rollout

1. Pin a clean reviewed release containing this router, tenant gate, admin screen, and notification gate. Pin the migration source and catalog verifier separately. The API remains fail-closed before migration; status-only activation can retain the old dispatcher because `dnd_enabled` stays false.
2. Route the reviewed status-capable API through the guarded API rollout. Apply the additive migration through the separately reviewed database process. Verify both profile tables, constraints, keys, owner, effective database-role grants, and `dnd_enabled NOT NULL DEFAULT FALSE`. Do not alter or backfill profile rows or membership roles. The settings table starts empty, so every tenant remains disabled. The existing DND v4 operator's active-route, worker, migration, and catalog pins are not valid receipts for this independent status-only route.
3. The owner or administrator then opens `/admin/profile-status`, reviews the status-only behavior, and explicitly enables the selected workspace. Verify that a member can update availability, status text, and work location, that DND selection is absent and a direct DND mutation fails, that ordinary chat alerts still dispatch, and that another tenant remains disabled. Do not treat source, schema, or route verification as live APNs/provider proof.

The DND rollout operator and manifest must be revised and independently reviewed against the then-current active route, worker provenance, and migration/catalog hashes before they can commission DND. A later operator must prove the DND-aware dispatcher is active, that the API reads the new gate, that no unexpired historical DND row would unexpectedly resume suppression, and that provider and rollback paths are safe before setting `dnd_enabled=true` for a selected tenant. The existing v4 operator does not set this column and cannot by itself make DND available. No admin or member RPC can set it.

Rollback is forward-only at the database layer. For status-only workspaces with `dnd_enabled=false`, ordinary alerts can continue on the old dispatcher. If DND is later commissioned, use only the reviewed DND-aware dispatcher and its guarded rollback; an old dispatcher must not be treated as proof of DND suppression. Retain both tables and all user status rows, including when a tenant is disabled. Do not drop or truncate profile tables.

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
