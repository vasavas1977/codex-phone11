# Phone11 voicemail commissioning: source candidate, hook off

This is an operator sequence, not evidence that voicemail is live. The source
bundle, image, schema, hosted API, loaded FreeSWITCH dialplan, provider path,
and two real phones are separate gates. Record exact hashes and artifacts at
each gate. An operator must stop on any mismatch; do not bypass a failed
handoff check by editing its pin or turning the hook on.

## Observed starting point and decision record

On 26 September the active FreeSWITCH container used `safarov/freeswitch`
image ID `sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6`
with FreeSWITCH 1.10.12. It had loaded `mod_lua` and `mod_voicemail`, but no
Node or `flock`, no voicemail outbox, and an empty 0755 `fs_voicemail` volume.
Its default `storage_dir` was `/var/lib/freeswitch/storage`, **outside** that
volume. The live API was 3011; the new storage migration and hook were off,
and extensions 3001 and 1020 had `voicemail_enabled=false`. These are dated
observations, not reusable production pins. Reinspect the active containers,
Compose configuration, database catalog, and loaded dialplan before any
change. The reviewed local same-image, network-isolated callback trace is in
`VOICEMAIL-FS-CALLBACK-ISOLATED-20260926.md`; it is not live call proof.

The release design deliberately adds a derived FreeSWITCH image, a separate
supervised Node relay, and a root-private durable outbox. The original base
image, original Compose file, existing SIP routing, and rollback image are
preserved. `voicemail.compose.yml` is an overlay for the active VoIP Compose
project, never a standalone deployment. The explicit `storage-dir` in the
release-mounted `voicemail.conf.xml` makes FreeSWITCH write under the mounted
voicemail volume. This may change legacy voicemail behavior even while the
Phone11 hook is off; verify the volume is empty, inspect existing voicemail
routes, drain calls, and hold a rollback before replacing FreeSWITCH.

## Gate 1: reviewed source and isolated evidence

1. Have an independent reviewer accept the exact source SHA and diff for the
   Lua adapter, producer, relay, duration parser, storage config, Dockerfile,
   overlay, release packer, and startup checks. Record that SHA; do not use a
   mutable branch name as a release identity.
2. Run `pnpm build:voicemail-workers` on the reviewed, clean checkout with the
   lockfile; run the focused producer/relay, Lua, package, and runtime-check
   tests. Build output is not a deployment or a live callback test.
3. Recreate the isolated FreeSWITCH callback proof against the **exact** base
   image chosen for deployment: answered bypass, no-answer DTMF, caller hangup
   during recording, and early abandonment. Use the reviewed
   `tests/phone11-voicemail-callback-clone.py` on a Linux Docker host with a
   fresh root-owned 0700 output parent and exact clean source SHA:

   ```sh
   python3 tests/phone11-voicemail-callback-clone.py --execute-clone \
     --source-sha "$REVIEWED_CALLBACK_SOURCE_SHA" \
     --output "$PRIVATE_CALLBACK_PARENT/capture"
   ```

   The harness refuses other images, missing/dirty source, non-root/non-Linux
   execution, and an output parent that is not root-owned 0700. It creates only
   a disposable no-network, no-mount clone with a `/probe` tmpfs, copies exact
   reviewed Lua and runner bytes into it, verifies loaded XML and modules,
   originates four synthetic loopback calls, copies raw evidence, and removes
   the clone. A failed call leaves the partial private capture for diagnosis;
   never package or approve a partial capture. Require a valid final RIFF/WAVE
   with nonzero material duration. Source tests do not close this gate.
4. Obtain a fresh, protected active-database `pg_dump -Fc` and independent
   SHA-256 receipt. Validate the migration against a disposable restore and
   preserve the receipt. Before active schema apply, run the reviewed
   read-only handoff check against current exact container/image/catalog,
   loaded dialplan, and the callback proof below. Its older active-state pins
   must be reviewed and updated when the live state changes. A blocked result
   is a stop signal, not permission to proceed.

The callback proof is a root-owned 0700 directory containing root-owned 0600
raw files, copied from the short-lived no-network clone before it is removed.
The fixture enters `/probe` through a verified tar stream because `/probe` is
tmpfs. Callback events and WAV bytes leave it through verified clone-side
reads that retain each file's original timestamp; `docker cp` is not used for
tmpfs paths. The proof includes `clone-inspect.json` (the full `docker inspect`
result), `fs-version.txt`
(observed FreeSWITCH version), `probe-runner.sh` (the exact source-controlled
stub copied from the clone's fixed runner path), `clone-harness.py` (the exact
source-controlled capture program), `loaded-dialplan.xml`, the unmodified
`clone-console.log`, `harness-transcript.log` (command outcomes and copy hashes),
and four directories named `answered`,
`no_answer_dtmf`, `caller_hangup`, and `early_abandon` (each 0700). Every case
contains `fs-trace.log`: copy the **actual FreeSWITCH console/log capture** for
that call. `answered` and `no_answer_dtmf` require emitted
`before_lua` and `after_lua` notices with their own channel UUID and the
synthetic bridge-cause variable. A caller hangup while recording ends the
channel before the post-Lua dialplan action can run. For `caller_hangup`, the
trace instead contains the emitted `before_lua` notice, the same b-leg UUID's
`loopback/9903-b` hangup and session-end notices, and exactly one intervening
`mod_voicemail` delivery to `9001@probe.invalid` within one second of hangup.
For `early_abandon`, the trace contains only the emitted `before_lua` notice
and the same b-leg UUID's `loopback/9904-b` hangup and session-end notices
within two seconds, with no delivery after the before notice. The harness
compares the clone mailbox WAV path-and-hash inventory before and after this
case and requires it unchanged; the case directory must contain only the
admission event and its trace, with no completion event or copied WAV.
The raw console must bind each case's lines in order; planned dialplan actions
and `EXECUTE` echoes are not emitted notices. Do not construct trace lines
from JSON or expected results. The answered trace must show
`NORMAL_CLEARING`, and the other three must show `NO_ANSWER` before Lua. The four UUIDs
must differ. `answered` has no callback event. `early_abandon` has only an
`admit.json` event. `no_answer_dtmf` and `caller_hangup` each have one
`admit.json`, one `complete.json`, and the runner's `complete-media.txt`.
For each completion, copy the exact path named in `complete.json` from the
clone's `/probe` tmpfs under `case/media/`, retaining its relative path,
bytes, and timestamp through the clone-side verified read. For example `/probe/mailbox/final.wav`
becomes `case/media/mailbox/final.wav`, with every directory mode 0700 and
file mode 0600. The media snapshot must have been written after the completion
event from the same clone, before any later file manipulation. The raw inspect
must show the
exact active base image ID, `NetworkMode=none`, no bind/production mounts,
no exposed ports, a `/probe` tmpfs, and no credential environment keys. Do
not export an inspect containing credentials; inspect it privately first.
The probe runner in `tests/phone11-voicemail-probe-runner.sh` accepts only
`admit`/`complete` and writes one JSON event into the `/probe/current-case`
directory. Install it only inside the disposable clone at the Lua hook's
fixed runner path; the production runner is a different artifact and must be
validated separately in the release bundle and active runtime. The test
runner writes the JSON events and an immediate hash/size/mtime snapshot of the
completed WAV; FreeSWITCH writes the WAV. Capture trace markers by instrumenting
only the disposable clone's dialplan around its Lua action and preserve the
full clone console log, not a hand-authored summary. Never synthesize event,
trace, or media files from the expected result. If an answered call does not
produce both trace markers, or a hangup call does not produce its b-leg
hangup/delivery/session-end evidence plus a final WAV and runner snapshot,
this proof gate fails and the operator must inspect the clone.
For each synthetic case, the clone dialplan must log the observed channel
identity and bridge outcome immediately before and after the Lua action, for
example with FreeSWITCH `log` actions containing
`PHONE11_VM_PROBE case=<case> uuid=${uuid} cause=${bridge_hangup_cause} stage=before_lua`
and the corresponding `stage=after_lua` when the channel survives. Keep the exact case name literal in
each disposable test route. These clone routes set the bridge-cause variable
to exercise the Lua branches; this is not evidence of a real unanswered or
answered SIP bridge. Real provider and handset call acceptance remains a
separate gate.
Verify the loaded clone XML contains these two actions and the Lua action in
that order before running calls. Copy the resulting case-specific FreeSWITCH
log bytes into `fs-trace.log` and retain the complete console capture inside
the packaged proof for independent review. The old clone trace predates these
markers and cannot be repackaged as a passing proof; rerun it on the exact
candidate image. No production dialplan receives these probe actions.
The evidence directory must contain exactly the
listed files and case directories. Preserve the original clone command,
console trace, and copy log separately in a root-private review directory.
The evidence must contain synthetic media only, no customer audio.

After independent inspection of those raw bytes, package a read-only proof:

```sh
python3 scripts/phone11-voicemail-callback-proof.py \
  --evidence-dir "$PRIVATE_CALLBACK_EVIDENCE" \
  --source-sha "$REVIEWED_CALLBACK_SOURCE_SHA" \
  --image-id "$EXACT_ACTIVE_FS_IMAGE_ID"
```

The command creates `callback.json` once with mode 0600 and prints its SHA-256.
Record that digest independently. It validates the exact reviewed Lua and
probe-runner and harness hashes, FS version/image, no-network inspect, loaded
dialplan action order, raw console marker binding, per-case source/image
pins and event hashes, four distinct traced call identities and exact case counts,
the completion's exact copied WAV path, snapshot hash, file ordering, and
material durations. This is isolated evidence; an independent reviewer must
also inspect the unmodified clone log and copy commands before accepting it.
A stale,
changed, extra, public, or symlinked artifact blocks. The proof validates
structure and consistency, not the truth of the Docker transcript by itself.
An independent reviewer must inspect the full raw console, loaded XML,
command/copy transcript, case events, and WAV paths and record a separate
root-private 0600 `review.json` under a root-owned 0700 review directory. It
must have exactly `schema` (`phone11.fs-callback-independent-review/v1`),
`callback_proof_sha256`, `clone_console_sha256`, `loaded_dialplan_sha256`,
`harness_transcript_sha256`, `clone_harness_sha256`, `source_sha`,
`freeswitch_image`, `reviewed_at_unix`, `reviewer`, and `finding` (`approved`).
The reviewer records the hashes from the raw capture and receipt, not from an
assistant-written expectation. Record this review file's SHA-256 independently.
This operator-recorded attestation binds what was reviewed but is **not**
cryptographic proof of reviewer identity or independence. Supply the two
independently recorded digests and source SHA to the host check:

```sh
python3 scripts/phone11-voicemail-handoff-check.py \
  --clone-receipt "$PRIVATE_CLONE_RECEIPT" \
  --callback-proof "$PRIVATE_CALLBACK_EVIDENCE/callback.json" \
  --callback-proof-sha256 "$APPROVED_CALLBACK_SHA256" \
  --callback-source-sha "$REVIEWED_CALLBACK_SOURCE_SHA" \
  --callback-review "$PRIVATE_REVIEW_DIR/review.json" \
  --callback-review-sha256 "$APPROVED_REVIEW_SHA256"
```

The host check still verifies exact active backend/FS containers, absent
schema, loaded XML with hook off, and module availability. Without the fresh
review file it returns `callback_independent_review_pending`; the prior raw
clone run predates this trace format and cannot be reused. A successful
`hook_off_handoff_ready` result is a hook-off pre-migration handoff with a
structurally validated clone capture and operator-recorded review. It does
not prove that the derived
image can boot, an active
call can deposit, relay delivery, or handset playback. The proof is valid for
24 hours and for this exact source/image; any change requires a new receipt.

## Gate 2: immutable image and private release, with hook still off

Build the derived image in a staging builder with adequate disk, not on the
small operator Mac or live VoIP host. Supply `FS_BASE_IMAGE`, `NODE_BASE_IMAGE`,
and `FLOCK_BASE_IMAGE` as immutable digest references from independently
reviewed registries. The FS base digest must resolve to the exact inspected
active base, not a later `latest` tag. Record full source-image digests,
platform, build logs, final image ID/digest, OCI revision label, Node major
version, `flock` version/provenance, and a successful executable smoke test.
The final image's Node and `flock` must actually run against the FS base's
libraries; a `COPY` success alone is insufficient. If the base lacks required
libraries, stop and redesign/review the image; do not add host binaries by
hand. Stage/pull only the reviewed final image and reviewed Node relay image;
use their immutable IDs/digests in the protected Compose environment. The
overlay uses `pull_policy: never` so an absent image fails closed.

After the source commit and build, create a bundle in a new owner-only
directory under an owner-only parent:

```sh
python3 scripts/phone11-voicemail-package.py \
  --source-sha "$REVIEWED_SOURCE_SHA" \
  --output "$PRIVATE_STAGE/voicemail-release"
```

The packer refuses a dirty or wrong checkout, independently rebuilds both
workers with the local `esbuild` installation to reject stale or substituted
`dist` output, and emits a manifest digest. Verify the builder dependency
against the reviewed lockfile before relying on this comparison.
Independently verify every file hash, manifest digest, source SHA, ownership,
and modes. Transfer the release to `/var/lib/phone11-voicemail/release` as
root-owned 0700 directory with its 0600/0700 files, without symlinks. Keep
previous release and original config in a protected rollback area.

Prepare `/var/lib/phone11-voicemail/outbox` as durable root-owned 0700 on a
backed-up filesystem. Prepare the named `fs_voicemail` volume as root-owned
0700 **only after** confirming the current FreeSWITCH user can still write and
that there is no legacy media to strand. The API's private `VOICEMAIL_PATH`
storage is a different volume: the relay uploads WAV bytes from the FS volume
to the API; mounting the FS volume into the API is not the handoff.

Provision `/var/lib/phone11-voicemail/runtime.env` root-owned 0600 using the
secret manager and protected host channel. Required keys are:
`PHONE11_VM_RELEASE_MANIFEST_SHA256`, `PHONE11_VOICEMAIL_SOURCE_ROOT` set to
`/var/lib/freeswitch/voicemail`, `PHONE11_VOICEMAIL_OUTBOX` set to
`/var/lib/phone11-voicemail/outbox`, `PHONE11_VOICEMAIL_UPLOAD_URL` set to
`https://api.phone11.ai/api/recordings/voicemail`, `FS_SHARED_SECRET` matching
the API integration secret, and `PHONE11_VOICEMAIL_MAILBOX_ROOTS` containing
only explicit approved tenant:extension-to-mailbox paths. Avoid secrets in
shell history, Compose command lines, tickets, or receipts. Docker access can
expose container environment; restrict it to the operator. Do not print the
expanded `docker compose config` because it may contain secrets.

Resolve mailbox roots from the actual target image and provisioned directory,
not the old volume's empty contents or a sample path. The September 27
read-only preflight found active tenant 1 accounts 1020 and 3001 with
`sip_domain=sip.phone11.ai`, `sip_username=extension_number`, and voicemail
disabled. The checked-in directory generator emits `vm-enabled` without
`vm-storage-dir`, `vm-domain-storage-dir`, or deprecated `storage-dir`.
The live effective directory has not yet been verified for all three
overrides. The active voicemail profile comments out
`storage-dir`, so it does **not** prove the new release's mailbox root. In the
[FreeSWITCH 1.10.12 source at commit `a88d069d6f`](https://github.com/signalwire/freeswitch/blob/a88d069d6f/src/mod/applications/mod_voicemail/mod_voicemail.c), explicit profile
`storage-dir` with default `storage-dir-shared=false` derives
`<storage-dir>/<voicemail-domain>/<voicemail-user>` unless the directory has
`vm-storage-dir`, `vm-domain-storage-dir`, or deprecated `storage-dir`.
The reviewed release config explicitly sets
`/var/lib/freeswitch/voicemail`. Consequently the candidate roots for those
two accounts are `/var/lib/freeswitch/voicemail/sip.phone11.ai/1020` and
`/var/lib/freeswitch/voicemail/sip.phone11.ai/3001`; these are **not**
observed live mailboxes or approval to enable either account. During feature-off
staging, requery the tenant/account/domain binding, inspect the effective
mounted profile and directory for all three overrides on the exact image,
and record the reviewed mapping privately before producer health checks. If
any input differs, stop and regenerate/review the map. The producer's first completed
WAV check then requires the real file under that admitted mailbox; a mismatch
must fail closed without a published message.

Stage the overlay and run Compose configuration resolution to a root-only
file. Review the resolved image identities, mounts, entrypoints, environment
key names, named-volume identity, service graph, and diff against the saved
active config. Confirm it changes only FreeSWITCH and adds the relay; the
original service definition still supplies its host network, healthcheck,
existing SIP/TLS/config mounts, command, and voicemail volume. Test the
`runtime-check.mjs producer` and `relay` gates inside the staged images;
their successful JSON may record source SHA but must not expose secrets or
the mailbox map. A failed check prevents startup.

## Gate 3: feature-off staging

Hold a scheduled maintenance window and preserve the original container
image ID, Compose/config snapshot, database backup, and rollback release.
Check no active calls before replacing FreeSWITCH. Keep
`PHONE11_VOICEMAIL_HOOK_READY` absent or false in the backend and all target
extensions `voicemail_enabled=false`. Apply the independently reviewed storage
migration only after the current handoff/restore gate passes; release the
backend with the hook flag **off**. Never enable the hook as a side effect of
schema deployment. Confirm API health, existing calling, and catalog triggers
before proceeding.

Start the derived FreeSWITCH service with the overlay, then its relay. Require
both healthy, exact image/source/manifest pins, private volume modes, no
unexpected restart, and no outbox error. Inspect loaded FreeSWITCH dialplan
XML through the event socket and verify the Phone11 Lua hook is absent while
the backend flag is off. Verify `mod_lua` and `mod_voicemail` loaded and that
`voicemail.conf.xml` has the exact mounted storage path. Run a normal answered
call to confirm preserved PBX behavior. Stage/enable the maintenance timer
only after the producer and relay are healthy; its sweep and reconcile jobs
must not overlap an unreviewed previous service. Keep monitoring storage and
quarantine growth. Preserve all original SIP and call handling checks.

## Gate 4: one supervised mailbox and live acceptance

Only after gates 1–3 pass, select one assigned, tenant-scoped pilot extension
(3001 or 1020), verify its mailbox root and owner epoch, and enable voicemail
for that extension. Enable `PHONE11_VOICEMAIL_HOOK_READY=true` in the backend
under the planned rollback window. Reinspect the **loaded** dialplan for that
extension and assert it names the staged Lua file; another extension must
still have no Phone11 hook. This flag and mailbox toggle are the action-time
activation gates. Preserve the feature-off path for immediate rollback.

Record a supervised acceptance matrix with exact timestamps, anonymized call
IDs, image/source/manifest pins, API build, database row IDs, and redacted
logs. Use real 3001/1020 phones and a signed app build where applicable:

| Path | Required result |
| --- | --- |
| Answered | Call and two-way audio work; no voicemail admission/message. |
| No answer, caller records >3 seconds | One admission, one final private WAV, material `duration_seconds`, one API message, correct owner's inbox playback. |
| Caller abandons before recording | No completed message; admission is retained/reconciled without fabricated audio. |
| Caller hangs up while recording | Closed valid WAV reaches outbox and owner inbox once. |
| API unavailable, then restored | Outbox/media remain private and durable, relay retries, exactly one delivered message after recovery. |
| Relay/container restart | No loss, duplicate, or cross-owner delivery. |
| Owner reassigned or voicemail disabled mid-flight | Old admission cannot deliver to new owner. |
| Other tenant or user requests list/play/read/delete | Authorization denies each operation. |

The web/phone inbox and push notification require their own signed-device and
provider delivery evidence. A healthy relay or DB row alone is not handset
acceptance. After the matrix passes, expand one mailbox at a time with a
separate change record; do not turn on voicemail for all extensions at once.

## Rollback and failure handling

If any gate fails, keep or restore `PHONE11_VOICEMAIL_HOOK_READY=false` first,
disable the pilot mailbox, and verify freshly loaded dialplan XML has no
Phone11 hook. Let in-flight calls drain. Preserve the root-private WAVs,
outbox, admissions, backup, and redacted failure traces; do not delete them
to make a healthcheck green. Stop the timer and relay if the producer or API
identity is suspect. Revert the FS overlay to the saved exact prior image and
Compose snapshot only after the call drain and a read-back of the old mounts
and config; verify normal answered and missed-call paths. Do not reverse the
storage migration automatically or restore a stale database over newer
calls. Source, hosted backend, PBX runtime, and handset outcomes must each be
reported separately.
