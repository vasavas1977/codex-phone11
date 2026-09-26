# Phone11 voicemail producer integration contract

`scripts/phone11-voicemail-producer.ts` is a source candidate for a trusted
FreeSWITCH-side call-flow hook. It is **not wired into the live PBX**. The
September 25 read-only host inventory found the active voicemail volume at
`/var/lib/freeswitch/voicemail`, but no completed message file or verified
post-voicemail execution path. The checked-in Compose example uses a different
path. Neither its path nor its module list may be treated as live authority.

The producer has two deposit commands. Each reads one JSON object from standard
input; do not put a secret, caller ID, or file path on a shell command line.
The trusted PBX hook must have these environment values: absolute private
`PHONE11_VOICEMAIL_SOURCE_ROOT` and `PHONE11_VOICEMAIL_OUTBOX`, exact HTTPS
`PHONE11_VOICEMAIL_UPLOAD_URL` ending in `/api/recordings/voicemail`, and
`FS_SHARED_SECRET`. It also requires `PHONE11_VOICEMAIL_MAILBOX_ROOTS`, a
trusted JSON map from `tenantId:extension` to the **exact absolute mailbox
directory** verified for the commissioned FreeSWITCH image and loaded
configuration. Do not populate this map from call metadata or guess its layout
from the repository's Compose example. In
[FreeSWITCH 1.10.12 at commit `a88d069d6f`](https://github.com/signalwire/freeswitch/blob/a88d069d6f/src/mod/applications/mod_voicemail/mod_voicemail.c),
an explicit profile `storage-dir` without `storage-dir-shared`
resolves to `<storage-dir>/<voicemail-domain>/<voicemail-user>` unless a
directory `vm-storage-dir`, `vm-domain-storage-dir`, or deprecated `storage-dir`
overrides it. The reviewed Phone11 release config sets the profile root to
`/var/lib/freeswitch/voicemail`, but
the active production profile had no explicit root and its voicemail volume
was empty on September 27. A path from the release config is therefore a
source-derived candidate until the feature-off deployment verifies that exact
config is loaded, checks the provisioned user/domain and absence of all three
directory overrides, and binds the resulting path in the private runtime map.
The first completed
deposit must independently match that path before delivery. Admission fails
when a mailbox is unmapped;
completion rejects a WAV outside that admitted mailbox. The producer must run
where the private FreeSWITCH volume
and a **durable** outbox are mounted; a transient container layer is unsuitable.
The root and outbox directory modes must be 0700. The hook must use a fixed
command path and pass input over stdin, never interpolate caller-controlled
values into a shell command.

1. Immediately before invoking the voicemail application, call `admit` with
   `{ "channelUuid": "<FreeSWITCH call UUID>", "tenantId": 1, "extension": "3001" }`.
   The tenant and extension must come from the authenticated PBX routing
   decision. The producer asks the Phone11 backend for admission with
   `x-fs-secret`, then writes `pending/<channelUuid>.json` as a private fsynced
   file. It returns the backend-issued `message_uuid`. On any error, the hook
   must **not invoke mod_voicemail for the Phone11 inbox**. The owner and owner
   epoch stay server-side in `voicemail_deposit_admissions` and are rechecked
   on upload.
2. Invoke `mod_voicemail`. Only after it returns with a nonempty
   `voicemail_file_path`, call `complete` with the same `channelUuid`, the
   absolute `voicemailFilePath`, and optional `callerNumber`, `callerName`, and
   whole `durationSeconds`. The producer requires a private source root, a
   regular WAV under it, and a matching durable pending admission. It writes
   `<message_uuid>.json` to the relay outbox using a 0600 temporary file,
   fsync, exclusive hard link, and directory fsync. It never overwrites an
   existing manifest. It removes pending admission only after the manifest is
   durable. A failed completion keeps the WAV and pending record for operator
   inspection or an idempotent completion retry.
3. Run `scripts/phone11-voicemail-relay.ts` against that outbox. It reads the
   completed manifest and WAV and uploads to the protected backend endpoint.
   200/201 removes only the manifest; 400/404/409 quarantines it; timeout/5xx
   retries. A later callback cannot overwrite an earlier quarantined manifest;
   conflicting evidence stays in the outbox for operator review. A mailbox
   reassignment after admission is rejected by the backend
   owner-epoch guard. The producer must not perform a delayed scan that infers
   ownership from the current extension assignee.

FreeSWITCH's official [voicemail reference](https://developer.signalwire.com/freeswitch/applications/voicemail/)
documents `voicemail_file_path`, `voicemail_account`, and
`voicemail_message_len` as variables set after the voicemail application.
The [module source](https://github.com/signalwire/freeswitch/blob/master/src/mod/applications/mod_voicemail/mod_voicemail.c)
formats `voicemail_message_len` as `HH:MM:SS`. The Lua adapter converts that
format to seconds and leaves the admission and WAV untouched if the duration
is absent or malformed; it must not silently publish a zero-duration record.
Its [Lua scripting reference](https://developer.signalwire.com/freeswitch/integration/scripting/)
documents synchronous call-context scripts. Neither proves the active host
runs a completion callback after a caller hangs up. Before wiring the hook,
verify on the exact active FreeSWITCH image that `mod_lua` or another chosen
hook is loaded, the module returns with a final private WAV path on answered,
abandoned, and interrupted deposits, and the producer runtime and durable
outbox survive container replacement. Test a completed deposit with backend
unavailable, relay restart, extension reassignment, and cross-tenant access.
Until that host-level trace and a signed two-phone test pass, keep the Phone11
inbox unavailable rather than claiming delivery.

## Gated FreeSWITCH call-flow source candidate

`server/pbx/freeswitch-routes.ts` now emits
`lua /etc/freeswitch/scripts/phone11_voicemail_deposit.lua`
for a tenant-validated, voicemail-enabled personal extension **only when** the
backend has `PHONE11_VOICEMAIL_HOOK_READY=true`. The default remains the prior
dialplan. The route passes the database-selected tenant, extension, SIP account,
and domain as validated Lua arguments; it never uses caller-supplied tenant or
mailbox data. The Lua source is
`infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua`. It admits a
deposit through the fixed Node producer command before invoking
`mod_voicemail`; a failed admission never starts an inbox recording. After the
application returns, it requires matching `voicemail_account` and
`voicemail_domain` and a nonempty `voicemail_file_path` before calling
`complete`. The producer then verifies a regular, stable RIFF/WAVE file under
the exact admitted mailbox, fsyncs it, and publishes the private manifest. An
absent/unfinished path leaves admission and media for review rather than
inventing a message. The Lua adapter uses a fixed command with JSON over stdin;
it never puts caller data or the integration secret on a command line.

This is a **source candidate, not a commissioned FreeSWITCH integration**.
`pnpm build:voicemail-workers` creates
`dist/voicemail/producer.mjs` and
`dist/voicemail/relay.mjs`; a reviewed release must install
the compiled producer at the Lua script's fixed
`/opt/phone11ai/voicemail/producer.mjs` path (or change both together), install
`scripts/phone11-voicemail-runner.sh` at the fixed
`/opt/phone11ai/voicemail/runner.sh` path, provide Node at
`/usr/local/bin/node` and `/usr/bin/flock`, and mount the Lua script at the absolute
`/etc/freeswitch/scripts/phone11_voicemail_deposit.lua` path. The relay needs a separate supervised runtime. Both need the
trusted mailbox map, secret, HTTPS API URL, private 0700 source root, and
durable 0700 outbox. The hook must stay disabled until a live answered,
unanswered, abandoned, and interrupted deposit trace proves that the active
FreeSWITCH image returns the final `voicemail_file_path` after the module
closes its WAV, including caller hangup. A local syntax check or source test
cannot establish that lifecycle behavior.

The September 26 read-only host check found a 0755 empty FreeSWITCH voicemail
volume, no Node binary in the FreeSWITCH container, no producer/outbox runtime,
no voicemail admission/message/owner-epoch database schema, and both 3001 and
1020 with `voicemail_enabled=false`. The active API has a durable private
`VOICEMAIL_PATH` bind mount but cannot read the FreeSWITCH volume. These facts
are explicit no-go checks for setting `PHONE11_VOICEMAIL_HOOK_READY=true`.

## Clone validation and guarded active handoff

The source handoff base is `6939177617a6bdb12f057121d044c1203583f3aa`.
The validator pins this base, the SQL digest, and the September 26 active
backend and FreeSWITCH container IDs/images. A changed active container or
database catalog requires fresh review and updated pins; do not weaken a check
to reuse an old receipt. The scripts have no live migration, deployment, or
hook-enable mode.

1. Through the protected backup procedure, make a fresh **custom-format**
   `pg_dump -Fc` archive of the exact active PBX database. Record its SHA-256
   independently with database identity, source container/image, time, and
   backup mechanism. Keep the archive owner-only (0600); keep its directory
   private. Do not put credentials, archive contents, or connection strings in
   a command line or a receipt.
2. As a non-root trusted operator on a machine with PostgreSQL command-line
   binaries and enough private disk space, run the local clone validator using
   the independently recorded digest (`initdb` refuses to run as root):

   ```sh
   python3 scripts/phone11-voicemail-clone-validate.py \
     --backup /protected/phone11-pbx.dump \
     --backup-sha256 "$APPROVED_BACKUP_SHA256" \
     --receipt /protected/receipts/voicemail-clone.json
   ```

   The receipt directory must be owner-only (0700) and the receipt must not
   exist. The operator restores the archive into a disposable isolated local
   cluster, applies the pinned migration **only on that clone**, checks the
   voicemail tables, column, functions, triggers, indexes, and extension row
   count, then removes the cluster. Keep
   the 0600 receipt with the protected backup proof. If restore, prestate,
   migration, catalog, or row-count validation fails, no receipt is produced.
   The protected active backup must stay on the VoIP host. That host has
   `pg_restore` but no host `initdb`/`pg_ctl`; use the reviewed Docker mode there
   as root instead of transferring customer data to an operator machine:

   ```sh
   python3 scripts/phone11-voicemail-clone-validate.py \
     --engine docker \
     --backup /protected/phone11-pbx.dump \
     --backup-sha256 "$APPROVED_BACKUP_SHA256" \
     --receipt /protected/receipts/voicemail-clone.json
   ```

   Docker mode pins the already present PostgreSQL 16 image by digest, disables
   networking and published ports, makes the root filesystem read-only, uses
   bounded private tmpfs for database files, mounts only staged backup and SQL
   files read-only, and removes its short-lived clone container. It creates the
   container under an unpredictable name and checks its identity and isolation
   before starting it; uncertain create/start results trigger cleanup by that
   name. If cleanup itself is uncertain, stop and inspect the reported clone
   name before doing anything else. The default
   data tmpfs ceiling is 4096 MiB; `--clone-data-mib` may be set from 256 to
   32768 after capacity review. Do not run Docker mode on a different image or
   connect the clone to the active PostgreSQL container or network.
3. Run the focused voicemail PostgreSQL and API tests against the restored
   clone or a representative disposable fixture, including an upload and
   list/play/read/delete with another tenant denied. The clone receipt proves
   migration structure and preserved extension count; it is not that API or
   handset acceptance proof.
4. On the pinned VoIP host, stage the two reviewed operator scripts and the
   protected receipt in a root-owned private directory, preserving the receipt
   as a root-owned 0600 file. Run the **read-only** handoff check as root so it
   can inspect the active Docker containers:

   ```sh
   python3 scripts/phone11-voicemail-handoff-check.py \
     --clone-receipt /protected/receipts/voicemail-clone.json \
     --callback-proof /protected/callback-evidence/callback.json \
     --callback-proof-sha256 "$APPROVED_CALLBACK_SHA256" \
     --callback-source-sha "$REVIEWED_CALLBACK_SOURCE_SHA"
   ```

   The check requires a receipt younger than 24 hours, the exact active healthy
   backend and FreeSWITCH images/containers, the known FreeSWITCH voicemail
   volume, all voicemail target catalog objects absent, and
   `PHONE11_VOICEMAIL_HOOK_READY` off. It checks local FreeSWITCH dialplan files
   and asks the running FreeSWITCH event socket for `xml_locate dialplan`. The
   event-socket password is read only inside the container from its protected
   configuration and is never printed. The check requires loaded dialplan XML
   without the proposed hook and confirms `mod_lua` and `mod_voicemail` loaded.
   It does not apply SQL or set the flag. The check also requires the private,
   fresh, raw four-case callback proof described in
   `VOICEMAIL-COMMISSIONING-20260926.md`, bound to the exact active FreeSWITCH
   image, Lua/probe-runner hashes, and an independently supplied receipt SHA-256.
   Missing or mismatched proof still ends with a blocked result. **Do not apply
   the live migration while this gate is blocked.** A passing isolated proof
   does not establish live caller audio, uploads, or handset playback. A
   changed image, source pin, or catalog requires a fresh review and receipt.

The next deployment stage still needs reviewed live backup/restore evidence,
the live schema apply, a guarded backend release with the hook flag off, a
private 0700 FreeSWITCH source root and durable outbox, the fixed Lua/runner/
producer paths with Node and flock, supervised relay and sweep/reconciliation,
and a verified `mod_voicemail` completion callback after caller hangup. Enable
one personal extension and the hook only after those gates and a signed
two-phone inbox/cross-tenant test. The September 26 active FreeSWITCH image has
the `mod_lua.so` and `mod_voicemail.so` files, but `fs_cli` could not prove the
modules loaded; file presence does not close the callback gate.

## Bounded abandoned-deposit reconciliation

The backend accepts an admission for at most seven days. Both the upload query
and database trigger enforce this limit. A trusted supervised job must run
`runner.sh sweep` followed by `runner.sh reconcile` regularly; once per hour is
the commissioning target. The runner serializes `admit`, `complete`, and
`sweep` with a kernel `flock` in the durable outbox. `sweep` moves pending
records older than eight days into private quarantine, leaving WAVs and
completed manifests untouched. It separates completed, abandoned, and malformed
pending evidence. `reconcile` asks the backend to retire an exact expired
admission, then moves its local evidence to `cancelled-pending` only after a
200 response; it retries on uncertainty. Bounded backend pruning also covers
completed deposits whose pending file was already removed.
Do not run the producer's `sweep` command directly without the lock runner.

The one-day grace between backend expiry and local quarantine assumes host
clocks are synchronized. Verify time sync, durable outbox ownership, atomic
hard links on that filesystem, timer supervision, and the exact runtime
binary paths on the active host before deployment. The September 26 read-only
inventory found no `flock` or Node in the active FreeSWITCH container, so the
cleanup and hook remain source-only. Old WAVs and quarantine evidence require
a separate retention policy; this job does not delete them.
