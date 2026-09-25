# Phone11 voicemail producer integration contract

`scripts/phone11-voicemail-producer.ts` is a source candidate for a trusted
FreeSWITCH-side call-flow hook. It is **not wired into the live PBX**. The
September 25 read-only host inventory found the active voicemail volume at
`/var/lib/freeswitch/voicemail`, but no completed message file or verified
post-voicemail execution path. The checked-in Compose example uses a different
path. Neither its path nor its module list may be treated as live authority.

The producer has two fixed commands. Each reads one JSON object from standard
input; do not put a secret, caller ID, or file path on a shell command line.
The trusted PBX hook must have these environment values: absolute private
`PHONE11_VOICEMAIL_SOURCE_ROOT` and `PHONE11_VOICEMAIL_OUTBOX`, exact HTTPS
`PHONE11_VOICEMAIL_UPLOAD_URL` ending in `/api/recordings/voicemail`, and
`FS_SHARED_SECRET`. It also requires `PHONE11_VOICEMAIL_MAILBOX_ROOTS`, a
trusted JSON map from `tenantId:extension` to the **exact absolute mailbox
directory** observed on the active host, for example
`{"1:3001":"/var/lib/freeswitch/voicemail/default/phone11.cloud/3001"}`.
Do not populate this map from call metadata or guess its layout from the
repository's Compose example. Admission fails when a mailbox is unmapped;
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
