# Phone11 voicemail inbox storage contract

The Phone11 app has a tenant-scoped voicemail inbox, private playback, read,
delete, and caller number for callback. `SERVICE_UNAVAILABLE` from the inbox is
the intended response when the `voicemail_messages` table is absent. The
FreeSWITCH voicemail module does not upload its completed audio to the API by
itself. Source completion does not imply service readiness.

Do not mark voicemail ready in a tenant until the following are completed
through the normal deployment process:

1. Review and apply `voicemail-storage-migration.sql` to the Phone11 PBX
   database. It adds `extensions.voicemail_owner_epoch`, a pre-record
   admission table, and the private message table. Reassignment rotates the
   epoch, including an away-and-back assignment.
2. Provide durable, writable `VOICEMAIL_PATH` storage to the Phone11 backend.
   The backend container's local filesystem is not durable unless its volume is
   mounted or replaced by a reviewed object-store adapter.
3. Confirm the actual FreeSWITCH container, voicemail root, backend container,
   volumes, and network from read-only live inventory. The September 25
   read-only inventory found active `p11-freeswitch` with Docker volume
   `phone11ai-voip_fs_voicemail` mounted at `/var/lib/freeswitch/voicemail`,
   and `cp11-backend` without that volume. The FreeSWITCH volume had no files,
   so its completed-message subdirectory and the event carrying the final WAV
   path remain unverified. The local `deploy/freeswitch/docker-compose.yml`
   describes a different container/path and must not be used as live authority.
4. Before the voicemail application starts recording, have a trusted PBX
   component call `POST /api/recordings/voicemail/admission` with tenant and
   extension using `x-fs-secret`. Persist the returned `message_uuid` for the
   whole deposit. If the call, identity mapping, or durable persistence fails,
   do not start a Phone11 inbox deposit. The admission snapshots the active
   personal owner and owner epoch under a row lock. A UUID generated only after
   recording, or a delayed scan that looks up the current assignee, is unsafe.
5. Commission a trusted FreeSWITCH-side durable outbox/worker. After the
   voicemail application confirms the final WAV, atomically write a private
   0600 JSON manifest using the admitted UUID, tenant, extension and relative
   WAV path; fsync it and its directory before treating the deposit as queued.
   `scripts/phone11-voicemail-relay.ts` consumes those manifests from a private
   outbox on the confirmed FreeSWITCH host. It retains each WAV and uncertain
   manifest across restarts, and uploads over TLS to
   `POST /api/recordings/voicemail`. The relay must send the configured
   `x-fs-secret` in a header; never put it in a query string or client app.
   Derive tenant and mailbox from an authenticated PBX mapping, not the caller
   number or untrusted event fields. A 200/201 acknowledgement clears only the
   manifest; 400/404/409 moves it to quarantine for operator review. A timeout
   or 5xx keeps it for idempotent retry. An event-only notification is
   insufficient because listener downtime loses deposits. A producer source
   candidate exists in `scripts/phone11-voicemail-producer.ts`, but the hook is
   **not commissioned**: an opt-in `mod_lua` adapter is emitted only with
   `PHONE11_VOICEMAIL_HOOK_READY=true`, and the active FreeSWITCH path and
   completed event have not been observed. Do not set that flag, enable the
   consumer alone, or claim end-to-end readiness. See
   `docs/phone11-daily-use/VOICEMAIL-PRODUCER-CONTRACT-20260926.md`.
6. Test a new voicemail with an assigned, voicemail-enabled extension and a
   different tenant. Verify list, playback, read, delete, and cross-tenant
   denial on a physical signed build.

Admissions authorize delivery for seven days only. A supervised producer
cleanup must run through the shared `flock` runner before any live hook is
enabled: it quarantines pending records older than eight days and reconciles
exact abandoned identities with the protected retirement endpoint. The
backend also prunes expired admissions in bounded locked batches. This
prevents interrupted deposits from retaining admission authority indefinitely
without deleting source WAVs, completed manifests, or quarantine evidence.
The active FreeSWITCH container does not yet have the required Node and
`flock` runtime, so this remains a deployment gate rather than a live feature.

## Read-only commissioning preflight

On the exact backend database, check `to_regclass('public.voicemail_messages')`,
the columns and guard trigger, and the backend role's table/sequence privileges.
If a prior candidate table exists without a non-null `owner_user_id`, stop the
migration and quarantine its rows. Do not infer an old message's owner from
today's extension assignment; the inbox readiness check fails closed for that
schema.
Inventory the active backend and FreeSWITCH containers, their image IDs, Compose
project or service unit, volume mounts, actual voicemail file path, and their
runtime users. Verify that `VOICEMAIL_PATH` resolves to a durable private mount
that survives backend replacement and that the FreeSWITCH source volume survives
its replacement. Keep credentials out of captured output.

Before the migration, take a database backup and test restore on a clone. Apply
the reviewed SQL once to the clone, run the isolated PostgreSQL test and a
representative upload/list/play/read/delete flow, then schedule the live apply.
The clone proof operator is `scripts/phone11-voicemail-clone-validate.py`.
It accepts only a same-owner 0600 `pg_dump -Fc` archive and an independently
approved SHA-256 digest, restores into a new 0700 local PostgreSQL cluster with
TCP disabled, requires the voicemail target catalog to be absent, applies the
SHA-pinned SQL there, verifies the target catalog and unchanged extension row
count, and writes a new 0600 receipt under a 0700 directory. It never connects
to the active database. Preserve the protected backup and its independent
source/database identity evidence; the receipt alone does not prove where the
archive was taken. The read-only `scripts/phone11-voicemail-handoff-check.py`
requires a fresh clone receipt, exact active backend and FreeSWITCH IDs/images,
the known voicemail volume mount, absent target catalog, and the hook flag off.
It also checks the local FreeSWITCH hook path, dialplan files, and loaded
`xml_locate dialplan` XML through the protected local event socket. It confirms
`mod_lua` and `mod_voicemail` loaded, then blocks at
`fs_voicemail_callback_unverified` until the final-WAV lifecycle is proved.
Do not apply the live migration while that gate is blocked.
See `docs/phone11-daily-use/VOICEMAIL-PRODUCER-CONTRACT-20260926.md` for the
operator order and remaining live gates.
The migration adds voicemail tables, indexes, functions, a trigger, and one
`extensions` owner-epoch column. Its rollback is to disable new admission and
stop the relay, preserve the voicemail media and tables as an audit copy, and
restore the prior backend deployment. Do not drop the epoch column or trigger
while any new backend writes messages. Drop new objects only after export and
confirmation that no messages need retention.

Confirm mailbox administration with `extensions.update` using
`voicemailEnabled`; enable only a user extension assigned to an active member.
The backend `pbx.voicemail.storageStatus` procedure reports the schema and
writable media directory separately. This backend-only port does not include
the newer `/admin/voicemail` screen. Neither check proves the volume survives
replacement or that FreeSWITCH delivers completed messages.
Disabling a mailbox stops new uploads but keeps prior messages subject to the
deposit-time owner's active tenant membership. A changed assignee cannot see
the extension's historic messages. Team and shared mailbox ownership is a
separate future design; this path accepts only personal user mailboxes.

## Upload request

The endpoint accepts only a WAV body and the following query values:

| Field | Required | Rules |
| --- | --- | --- |
| `tenant_id` | yes | Active tenant numeric ID |
| `extension` | yes | Active voicemail-enabled destination extension |
| `message_uuid` | yes | UUID returned by pre-record admission and persisted through relay retries |
| `caller_number` | no | Up to 64 printable characters; blank for withheld caller ID |
| `caller_name` | no | Up to 160 printable characters |
| `duration_seconds` | no | Whole seconds from 0 through 86,400 |

The same `tenant_id` and `message_uuid` may be retried only for the same mailbox
and admitted owner/epoch with byte-identical audio. A reassignment after
admission rejects the delayed upload with 409 before media write; keep the
source WAV in quarantine rather than assigning it to the new owner. The server
keeps media in a tenant-only path and requires an explicit active assignee. List,
playback, read, and delete require the captured owner and active tenant
membership; reassignment does not transfer old messages. An uncertain database
failure may leave an unindexed WAV; retain it for
safe reconciliation because a concurrent upload may have committed that path.
Clients must not display an unavailable inbox as an empty inbox.
