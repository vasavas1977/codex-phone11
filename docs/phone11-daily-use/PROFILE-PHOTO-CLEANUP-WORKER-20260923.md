# Phone11 profile photo cleanup worker

The profile photo cleanup worker runs independently from the API. It has no
HTTP listener and starts only with `PHONE11_PROFILE_PHOTO_WORKER=1`. It uses the
same database settings and persistent `/var/lib/phone11/chat-media` volume as
the API. Its PostgreSQL session advisory lock admits one dedicated worker at a
time; losing the lease connection stops cleanup work until the worker restarts.
Cleanup runs immediately and then every 15 minutes by default. The configured
interval is bounded from 60 seconds to 24 hours.

The production image bundles `dist/profile-photo-worker.mjs`. Run it as a
dedicated supervised container with the normal Phone11 database environment,
the shared private media volume, no published ports, and:

```sh
PHONE11_PROFILE_PHOTO_WORKER=1 \
PHONE11_CHAT_MEDIA_PATH=/var/lib/phone11/chat-media \
node dist/profile-photo-worker.mjs
```

The backend image's default Docker health check calls the HTTP API on port
3000. A worker container has no HTTP listener, so its service definition must
disable that inherited check and replace it with a worker-specific readiness
check. Before commissioning, prove that the process holds the advisory lease,
has completed a cleanup tick, and is restarted by its supervisor after a lease
loss. A merely running container is not worker-readiness evidence.

The worker refuses to start without the exact opt-in, a configured and
accessible media path, and a database lease. Missing photo tables are safe: the
existing maintenance routine checks their presence and does no work until both
tables exist.

## Ownership during rollout

The normal API's media retention cycle also calls profile photo maintenance in
source builds that contain that implementation. Set
`PHONE11_PROFILE_PHOTO_CLEANUP_EXTERNAL=1` on **every** such API instance before
assigning cleanup to the dedicated worker. This keeps chat attachment cleanup
active and skips only profile photo cleanup. The environment setting is
opt-in; without it the existing API behavior is preserved. The worker's
advisory lease prevents two dedicated worker processes from owning cleanup at
once. Do not start it if any active API owner cannot honor the external-owner
switch or otherwise provides verified database/file locking.

The lease is checked before each cleanup cycle. If its connection fails during
a cycle, another worker may acquire the global lease before the first cycle
finishes. Per-photo owner transaction locks and locked deletion-queue rows
protect the underlying mutations; the lease alone is not a claim that cycles
can never briefly overlap. Keep that behavior in the rollout review.

Current production evidence must be checked separately for each deployed image:
the active default backend inspected on 2026-09-23 did not contain
`maintainProfilePhotoStorage` in its bundled API, and the active
`api-candidate-channel` runs workerless. That read-only observation is not a
future deployment guarantee.

This worker does not commission photo uploads. Keep
`PHONE11_PROFILE_PHOTO_COMMISSIONED` unset until both photo tables are migrated,
the authenticated `/api/profile/photo` routes are served by the selected API,
the private media volume is mounted and writable by the service user, and the
worker ownership handoff is verified. The worker source and bundle do not
change the backend image's default command.
