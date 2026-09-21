# Phone11 workspace profile status

`migration.sql` creates tenant-scoped manual availability, status text and work-location preferences. The app does not apply it at startup. Apply it only through the reviewed Phone11 database migration process.

The router authenticates the owner from the session and never accepts a target user ID for writes. Reads require active membership for the caller and each returned colleague. If an older deployment lacks this migration, reads report an unavailable capability and the presence path must continue with its automatic state; writes fail without claiming success.

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
