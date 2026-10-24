# Voicemail delivery runtime commissioning — 23 October 2026

**Current runtime update:** the compatible derivative backend is built, running
with restricted TLS database access, and serves the main admin tRPC route.
Its owner-epoch absent-tenant check passed without creating an admission.
The public voicemail recording routes also switched to that API at 14:26 UTC,
with the old directory and fallback redemption service retained on 3013.
FreeSWITCH was then replaced successfully at 15:58 UTC. All four previously
running profile/transport pairs, shared storage and other protected processes
were preserved. The new container has restart `always`; the previous container
is retained stopped with restart `no`. The actual FS child credential passed
the new backend's absent-sentinel check, with no admission or media created.
Loaded voicemail guard structures match, but trusted ingress reachability and
relay remain uncommissioned; delivery is not complete. See the
[live database/API release record](PBX-DATABASE-RELEASE-20261023.md).
The preparation observations below describe the earlier baseline where stated.

The producer, deposit helper and relay must be deployed as one reviewed bundle.
The earlier runtime inventory found older installed bytes and no
`phone11-voicemail-relay.service`. A later fixed-path observation confirmed an
underlying legacy helper exists; it is not an explicit immutable bind mount.
The seven-artifact release was subsequently installed through immutable mounts during the controlled replacement described above.
Those earlier observations established the compatibility gap addressed by this
release. The retained `c5140f4cb0caebce1225b8e45d41c5b9a40af9a9` source matched the
older deposit helper and lacked `/voicemail/admission/idempotent`. The new
compatible derivative is separately bound by its reviewed installed-bundle and
image hashes in the live database/API release record. Container names alone are
not release evidence. Keep the old API for the directory and fallback
issuer/redemption routes; do not restore recording uploads to an incompatible
backend while the new producer is active.

The historical `phone11-mainline-release-start.py` and its prerequisite module
remain bound to their original backend topology. Do not edit their pins or feed
the current backend into that historical release operation. The independent
`scripts/phone11-voicemail-relay-runtime.py` accepts an explicitly named current
backend and checks immutable IDs, images and installed code hashes. The default
v1 lane also requires its exact commissioned start epoch. The explicitly selected
trusted lane permits a new process after the same container restarts, while
requiring stable process, complete creation/host configuration and full mount
rows across each check. Mount destinations must be unique; ordering alone is
ignored. All trusted protocol and owner-epoch evidence remains mandatory.
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
Include an explicit legacy-helper bind to the new release. The actual container
entrypoint is `/opt/phone11ai/voicemail/fs-entrypoint.sh`, which invokes the
unchanged `runtime-check.mjs` before `/docker-entrypoint.sh`. The native startup
check binds ten files through `release.json` and
`PHONE11_VM_RELEASE_MANIFEST_SHA256`. A seven-artifact directory alone is not a
bootable replacement; four runtime overlays alone also invalidate the old
manifest. Preserve the complete bootstrap closure and construct a matching
manifest for the reviewed replacement bytes without weakening the check.
The first stopped candidate remains ineligible to start for this reason.
A corrected stopped candidate, `d20db374166e1653cb132768ee6c3e11b614208caa38fc765cea7bc0354ba8dc`,
preserves the original runtime directory, overlays the reviewed helpers and a
matching ten-file manifest, and retains the original recording/voicemail volumes
and outbox. Its unchanged startup guard passed at 15:41 UTC in a separate
network-disabled, read-only Node container. The actual FreeSWITCH candidate was
still stopped, and all protected service processes were unchanged. This isolated check proved only the startup manifest checks. The subsequent
controlled replacement proved the running lifecycle and preserved phone profiles;
media delivery remains a separate boundary.

The corrected runtime manifest SHA is
`7fe5bec292f7157d32e4f397780b903a5e3b73858b5bc9aa79b4741bf83e431e`.
The retained native create and isolated-check receipts are respectively
`/var/lib/phone11-voicemail-fs-candidate-oct23-v2/99-result.json` and
`/var/lib/phone11-voicemail-fs-bootcheck-oct23-v1/99-result.json`.
Their SHA-256 values are
`a6d76540a220ab372d49bf8025725c9cec9844d22c43c98a22d2de1e5a0f4f8d` and
`07b3a65e6f6fb2c79f1334f927736443544dd65c38eed0b370807059584f9049`.
The accepted replacement receipt is
`/var/lib/phone11-voicemail-fs-replace-oct23-v2/99-result.json`, SHA-256
`50ba2fdb7991364b692213cb96ac508354fc566e5d683b6e2fbd3007e0b9f34f`.
Current container `d20db374166e1653cb132768ee6c3e11b614208caa38fc765cea7bc0354ba8dc`
runs as `p11-freeswitch`, PID 2376529, started `2026-10-23T15:58:23.605826924Z`.
The actual FreeSWITCH child was PID 2376563 at the postreplacement checks.
The completed loaded proof is
`operator/PBX-VOICEMAIL-FS-LOADED-PROOF-20261023-v2.json`: both guarded context
structures match and Lua, voicemail and XML-curl modules are loaded. The selected
XML-curl endpoints, scalar parameters and repeated form-field sets match the
expected directory/protected configuration. Certificate/key/CA bindings and
certificate/hostname verification are configured on the protected HTTPS binding.
The public voicemail entry follows eighteen earlier extensions, with thirteen
terminal actions; its presence does not prove SIP routing reachability.

The first loaded observation rejected documented repeated `enable-post-var`
entries. The corrected read-only projector allows only that repeatable parameter,
with unique values from the exact per-binding field allowlist; all other duplicate
names still refuse. It uses FreeSWITCH's actual `enable-cacert-check` and
`enable-ssl-verifyhost` names. No live XML change or reload was made to resolve
that observer error. The prior lifecycle preflight similarly refused the
published `(TLS)` status suffix; its corrected parser preserves each running
profile and transport pair. Both earlier refusal records remain retained.
The old container is named `p11-freeswitch-rollback-oct23-v1`. The bounded
recovery operator refuses a running new container; pause/drain must precede any
rollback that could interrupt new calls. Do not blindly rerun a forward packet.

Retain the old release and complete old container definition for rollback. If continuity of
the shared FreeSWITCH process cannot be safely preserved, stop at staged files
and report the required replacement window; do not mutate active inodes.

The current producer reads acknowledged historical pending records that contain
`messageUuid` without `admitted`. A new uncertain intent deliberately has
`requestMessageUuid` and `admitted:false`; older producers cannot treat it as
admitted. New admission uses `/admission/idempotent`, exact request/response UUID
and the server-side deposit owner/epoch. An old backend without that endpoint
fails closed before recording. This prevents false admission. The current upload backend passed the protocol
boundary check described above; that check does not prove a real deposit or
mailbox delivery. Review its exact
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
The historical source-preparation image-build prerequisite is now resolved:
the compatible derivative is running, and the corrected FreeSWITCH runtime and
voicemail guard structures are installed. Trusted ingress reachability,
issuer/redemption lifecycle and mailbox delivery remain outstanding; no completed
activation packet or delivery is implied by the build and runtime transition.

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
