# Voicemail delivery runtime commissioning — 23 October 2026

The producer, deposit helper and relay must be deployed as one reviewed bundle.
The accepted runtime inventory found older installed bytes, a missing
`phone11_legacy_voicemail.lua`, and no `phone11-voicemail-relay.service`.
Those observations establish a compatibility gap; the current portal release
does not establish which voicemail protocol the ordinary backend implements.
The retained `c5140f4cb0caebce1225b8e45d41c5b9a40af9a9` source has a deposit
helper digest exactly matching the installed older helper. Its backend lacks
`/voicemail/admission/idempotent` and differs in storage/custody handling. The
current container name suggests that source, but its name alone is not an
image-to-source binding. Verify the actual backend artifact; if it is that
retained version, deploy a reviewed compatible backend before the current
producer. An old API receiving new admission requests will reject them.

The historical `phone11-mainline-release-start.py` and its prerequisite module
remain bound to their original backend topology. Do not edit their pins or feed
the current backend into that historical release operation. The independent
`scripts/phone11-voicemail-relay-runtime.py` accepts an explicitly named current
backend and checks immutable IDs, images, start epochs and installed code hashes.
Its packet digest is pinned separately in the rendered service unit. The unit
and packet must be root-owned, not writable by another principal, and retained
together with the independently reviewed bundle manifest.

`--check` projects Docker identity metadata, hashes five fixed runtime artifacts
and the backend bundle, and runs Node probes that emit only selected directory,
version, configuration and secret-present metadata. It does not list an outbox,
read WAVs, invoke an admission endpoint or change a service. The probes observe
new exec process configuration, not the original API or FreeSWITCH environment.
The exact native-process configuration, HTTPS upstream, backend wire/auth/owner
contract, loaded Lua, filesystem durability and final-mailbox lifecycle remain
separate commissioning prerequisites. A packet is caller-supplied configuration,
not authenticated evidence of those prerequisites.

`--run` repeats those checks and performs one relay pass inside the pinned
FreeSWITCH container, using the existing secret there. The default v1 lane requires both hook
flags true. It serializes service passes with the fixed outbox `.relay.lock`.
Only delivered/quarantined/retry totals leave the relay invocation. Delivery
with retries or quarantined messages must be reconciled; process exit zero
does not prove a particular message reached its owner. No WAV is deleted by
the relay, and failed/uncertain requests retain evidence. Confirm that no other
relay is running under a different service or manual session before enabling
the new timer; older workers do not participate in this lock.

Use `deploy/systemd/phone11-voicemail-relay.service.in` and its timer only after
the protected packet is reviewed. Replace `CONFIG_SHA256` with its exact digest,
install the guard as `/var/lib/phone11-voicemail/operator/relay-runtime.py` and
the packet as `runtime.json` in that root-owned 0700 directory. Stage the units
disabled, run `systemd-analyze verify` on the rendered units on the target host,
and run the guard with `--check`. The service requires Docker and uses its Unix
socket; it does not provision or copy secrets into the host unit or packet.
Enable/start the timer only after activation admission. A timer start schedules
its first pass in 30 seconds and does process queued audio.

The live mount model requires particular care. The older deposit helper is a
single-file read-only bind mount, nested below `/etc/freeswitch`, and the runtime
programs live under a directory bind mount. Atomically replacing the host helper
pathname does not replace the inode already mounted into the container. Copying
over an active inode risks a partial script read. Use a fresh immutable release
directory and a controlled container replacement retaining the exact image,
network, recording/voicemail volumes, outbox and all unrelated mounts/config.
Include an explicit legacy-helper bind to the new release. Retain the old
release and complete old container definition for rollback. If continuity of
the shared FreeSWITCH process cannot be safely preserved, stop at staged files
and report the required replacement window; do not mutate active inodes.

The current producer reads acknowledged historical pending records that contain
`messageUuid` without `admitted`. A new uncertain intent deliberately has
`requestMessageUuid` and `admitted:false`; older producers cannot treat it as
admitted. New admission uses `/admission/idempotent`, exact request/response UUID
and the server-side deposit owner/epoch. An old backend without that endpoint
fails closed before recording. This prevents false admission; it does not prove
the currently running old backend supports the protocol. Review its exact
source/runtime against the current admission, retirement, upload idempotency,
owner-epoch and static-route contracts before enabling both flags.

Rollback first stops/disables the timer and waits for any active oneshot to
finish. Do not force-stop its Docker client: the in-container exec can outlive
it. A retained `.relay.lock` file is harmless; the kernel releases the lock when
the actual worker exits. Refuse replacement while a worker or voicemail deposit
is still in flight. Quiesce admissions with a coordinated backend/FreeSWITCH
flag transition under the approved route policy; a one-sided flag mismatch can
temporarily reject calls, and stopping the timer alone does not stop deposits.
Restore the retained container/release only after quiescence. Preserve the
source WAV volume and the complete outbox including `pending`, quarantine,
retired evidence, temporary hardlinks and lock files. Never restore an older
outbox snapshot over newer admissions, infer historical owners from current
extension assignment, or auto-retire a pending record. If the old backend cannot
consume the retained protocol, leave the timer stopped and hooks off; recovery
uses the compatible bundle later. Do not use `docker compose down -v`.

Source lifecycle rehearsals cover admitted completion, retry, restart, wrong
mailbox, reassignment and uncertain acknowledgement. They do not establish the
real mod_voicemail final-WAV callback, mailbox mapping or physical-phone audio.
No phone tests, real calls, customer-audio inspection, mailbox activation,
provider change or trial-license change is required to stage this packet.
The 60-second trial and deferred Android/physical-phone acceptance remain.


## Explicit trusted local fallback lane (source only)

The installed one-use local fallback Lua is a different protocol from the global
`phone11_voicemail_deposit.lua` hook. Its pinned Kamailio source and opaque
reference are redeemed by `local-fallback-ingress.mjs` into a private canonical
handoff. The Lua must carry `expectedOwnerEpoch` into admission before recording.
It does not read `PHONE11_VOICEMAIL_HOOK_READY`. Enabling unrelated static/global
hooks is therefore not a prerequisite for this lane.

The default v1 packet, CLI behavior and service remain unchanged. A v2 packet
must select `lane: "trusted-local-fallback-owner-epoch/v1"` and explicitly pass
`--trusted-local-fallback-owner-epoch`. Both native and backend global hook flags
must remain **false**. A v2 packet without the CLI selection, an old backend,
missing source/ingress evidence, or a mismatched artifact refuses before a relay
pass. Setting a flag or changing only a packet schema cannot bypass these checks.

This protocol revision is bound to the reviewed seven-artifact release, including
`phone11_voicemail_local_fallback.lua` and `local-fallback-ingress.mjs`, and the
required owner-epoch admission endpoint. The canonical five-file manifest SHA is
`177ea04054d5b46784b6551dd90d456bdf208e30601ccefbe4548b2dbc8fa29b`;
its sourceRevision is the recorded base `34a2ea092f8ff21c7e649dd26176109b1929ee3d`
while exact captured producer input and runtime digests bind the later patch.
The guard pins all seven output digests, producer source
`4e8e228ac5866641d2572175216f54e97f92468b67dcc72140cc0c1de0e8fc7a`,
retained ingress source
`3b82b1e2ecad495ea507f16a99e2211233ed183711d69b8f2a6146118d411785`,
and required backend storage source
`053412f0f89e35d00144f31729a5fd27424431a1ea4ac5fd1415aafbdfdc6de6`.
The required compiled backend bundle is
`e1c270e67b1f6d4bc3ed484a74a90c3143cc3b6ddb8db5698208173988c60e5b`.
Its existing `/health` build and inherited build-manifest describe the base
image; they cannot prove the patched owner-epoch contract. A different release
requires independently reviewed source pins, not caller-supplied replacement
hashes under this protocol revision.

The v2 packet retains all common v1 fields and adds `lane` and `protocolEvidence`.
Its `artifacts` contains exactly the seven names and pinned digests in the guard.
`protocolEvidence` has two `{path, sha256}` references. Both files must meet the
same no-follow, root-owned 0600/private-parent custody as the runtime packet:

- `backendDerivative` is the immutable external source derivative manifest,
  SHA `d5dd86c723b2db9bce4b567501552b39c57622c5cc863a1ff462e2052d714dc8`.
  Its schema is `phone11-voicemail-epoch-backend-derivative/v2`, and its exact
  sorted sourceChanges are `server/invitations/service.ts`,
  `server/pbx/database-readiness.ts`, and `server/pbx/recording-storage.ts`.
  The first two bind schema-fix commit `d759507aa919d1ebd9323533cb4bafc5711b756e`;
  storage retains owner-epoch commit `019beb3e62f8bc3a56dcc6cf899aedc1a9c625fc`.
  All three reviewedSources entries must match their pinned source/base hashes,
  byte lengths and commits. The superseded storage-only bundle/manifest refuse.
  Its source-only/imageBuilt=false facts remain source-only. The guard separately
  requires the actual new backend ID/image/start epoch and hashes the installed
  bundle against the reviewed patched output; it refuses the old base image.
- `trustedIngress` is a separately reviewed commissioning record created from
  **actual accepted runtime and loaded-ingress receipts**. Its schema is
  `phone11-trusted-local-fallback-commissioning/v1`, status is
  `loaded-one-use-owner-epoch-ingress-bound`, and lane matches the packet. It
  binds both runtime identities, backend bundle, derivative digest, actual backend
  runtime-proof SHA, exact upload URL and accepted route-proof SHA, the required
  owner-epoch endpoint, all four source input hashes, both actual global flags false,
  the native Kamailio IP/loopback redemption base/private handoff root, and loaded
  public-entry/context/proof hashes. Its loaded context must be
  `phone11-local-voicemail`, with one-use reference, authenticated source and
  canonical owner-epoch handoff checks all established. Exact field names are
  defined by `trusted_evidence()` and its synthetic test fixture.

The commissioning record is privileged reviewed evidence, not a self-authenticating
claim. Do not create it from source templates or script presence. The guard binds
its digest and runtime epochs, rechecks installed bytes and native configuration,
and re-reads the evidence immediately before a pass. It does not independently
reproduce the operator's loaded-XML, issuer/redemption or owner-lifecycle proof.
At source preparation, the loaded trusted context remained unresolved and the
patched derivative image was not built. Those are real activation prerequisites;
no activation packet or completed delivery is implied here.

Use the separate `phone11-voicemail-trusted-fallback-relay.service.in` and timer
only for this v2 lane. Render its packet digest and stage it disabled alongside
`trusted-fallback-runtime.json`; its explicit protocol CLI option prevents
accidental use of the default lane. Run `--check` with the same selection before
considering a timer start. Neither `--check` nor this source change enumerates
an outbox, opens WAVs, redeems a reference or changes a service. A timer start
still processes queued audio and requires the existing commissioning admission.
Do not enable both timers or an older independent relay. They share the fixed
`.relay.lock`, but a worker outside this lock must first be reconciled. Preserve
the existing 3013 directory/redemption service and all unrelated global routes.
The storage/quiescence/rollback and deferred phone/audio limits above still apply.
