# Inbound voicemail and relay activation — 24 October 2026

Scope: finish inbound voicemail routing and the completed-message relay on the
existing Phone11 PBX. Retain the 60-second trial. Android and physical-phone
testing remain deferred. This record distinguishes configuration and API proof
from a recorded message reaching a user's inbox.

## Current result

Routing is admitted and the trusted voicemail relay is enabled. Its first
worker pass completed successfully at 11:02 UTC with delivered 0, quarantined 0,
retry 0 and no observed refusal. This proves operation of the configured relay,
not a recorded message reaching a mailbox. The 60-second trial remains unchanged;
Android, physical-phone recording and playback checks remain deferred.

## Completed live changes

- Enabled personal voicemail mailboxes for extensions **1020** and **3001** using
  the signed-in Phone11 admin portal's normal confirmation flow. Both displayed
  **Mailbox enabled** afterward. No other mailbox or account assignment changed.
- Created a loopback-only issuer candidate at port **3028**, retaining the exact
  legacy image, FreeSWITCH directory credential, mounts and application settings.
  Its only application changes are the local-fallback feature flag and a new
  private issuer credential. The service at 3013 was initially unchanged at
  that checkpoint. The candidate has no background workers and restart is off.
- Prepared private, inactive Kamailio configuration candidates with a dedicated
  voicemail authentication macro. Existing global Kamailio credentials and its
  backend URL were preserved. This preparation did not alter the running router.

- Replaced the live issuer/directory service at **3013**, preserving its image,
  FreeSWITCH directory credential and original runtime settings. The new service
  is `674ddc9ebdc9041388b5679df38d7703dcde325256a0d9b4636d6e0fee314329`,
  started `2026-10-23T18:33:55.202153099Z`, with restart policy `always`.
  The old service is retained stopped with restart disabled. FreeSWITCH's owned
  maintenance pause was released; protected services were unchanged. Both
  directions passed the live one-use protocol and directory-auth boundary.

## Verified runtime behavior

The original handoff failed because both test mailboxes were disabled, despite
valid extension, SIP account, active membership and owner-epoch mappings. The
ordinary admin changes resolved that failure.

At port 3028, both 3001 → 1020 and 1020 → 3001 passed authenticated mint (201),
redemption (200), canonical owner-epoch binding, rejection of missing/wrong
credentials, replay rejection, and consumption of a reference with a wrong call
binding. Four short-lived references were consumed. These were API checks:
no SIP calls, recording admissions, audio reads or customer messages were made.
The real running FreeSWITCH credential matched the candidate service.

Before the 24 October transition, Kamailio had no voicemail handoff or
initial-INVITE maintenance gate. Loading the callbacks required a controlled
restart. A zero-call snapshot alone is not
an admission fence and must not be represented as one.

Both prepared configurations (media disabled/enabled) subsequently passed the
installed Kamailio image's native configuration parser in isolated containers.
They used no network or published ports and mounted original inputs read-only.
Both probes were removed; the active router and other services were unchanged.
This proves parser compatibility, not that the live callbacks are installed.

The isolated media fixture stopped at RTPengine's version command because the
image's default configuration could not parse interface `default`. Its owned
containers were removed and production process generations were unchanged.
This failed fixture is not media acceptance. Its original `productionSecretsRead`
metadata was too broad: the Docker helper temporarily received full inspect
responses in memory before projecting process metadata; no credential values
were selected or exported and no secret files were opened.

After diagnosing that exact error, a separate v2 fixture supplied its own
loopback interfaces and disabled the image's default configuration. It passed
both SDES80 media modes against the currently installed FreeSWITCH image, payload
authentication/matching, the delayed-delete tombstone check, and six modeled SIP
transaction cases (no answer, cancellation before/during issuance, late issuance,
busy only, and busy followed by an answered fork). Its owned containers were
removed and production process generations were unchanged. This qualifies the
isolated fixture media transition and modeled transaction behavior; it
does not prove the live callback, final WAV completion or mailbox delivery.

A subsequent live identity check found that production RTPengine uses image
`d5bf3715baa197d89f89a70207d06d5509a4284b7392310a94a466ace07afb96`,
whereas the earlier isolated fixture used `9675c601...`. Therefore that fixture
must not be described as acceptance of the actual live RTPengine generation.
The native executable is `/usr/local/bin/rtpengine`, root-owned with group 50
and mode 0755. Its observed SHA-256 is
`b27500bcc0ed7f71eb1232854ca0e007c89e44a2e6e3ae0e3c80b46408bac6bc`.
The read-only native counter probe now binds that actual image, container,
process generation, executable metadata and owned UDP control socket. It
reported zero RTP sessions, zero FreeSWITCH sessions and zero Kamailio dialogs;
one waiting SIP transaction remained at that snapshot. This is not an admission
fence or authorization to interrupt an active call.

The replacement isolated fixture then ran the **actual production RTPengine
image and matching ELF**, alongside the installed FreeSWITCH and Kamailio
images. Both SDES80 media modes and the six modeled transaction cases passed.
All owned fixtures were removed and protected process generations were
unchanged. The native receipt SHA-256 is
`1112edc5ee44e5c0bafe535782c4ae19601f50c6ad5a7fed15f5a381bc896763`.
This closes the image mismatch for isolated qualification; it does not assert
that a real voicemail recording has traversed the live routing path.

The final maintenance configurations, including matching original To-user and
To-domain eligibility, also passed native parsing in both fenced and admitted
startup variants. Their initial-INVITE gate now precedes the early
carrier/canary branches. Admission is persisted separately for normal reboot;
this preparation has not yet replaced the live Kamailio process.

The v3 preparation also materializes the maintenance key in `htable:mod-init`.
An `initval` default alone does not create a cell that the native `htable.get`
RPC can read. Both corrected startup variants passed the installed native
parser; their disposable probes were removed without changing live services.

The obsolete loopback candidate at 3027 was gracefully stopped with exit code 0.
Its container and private evidence remain retained; no forced kill or deletion
was used. The accepted 3028 candidate remains available until routing closes.

## Evidence checkpoint

Operator evidence resides under
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/`:

- `PBX-VOICEMAIL-AUTHORITY-20261024-v1.json`: read-only account/owner checks and the
  original disabled mailbox flags.
- `PHONE11-VOICEMAIL-MAILBOXES-20261024.jpg`: admin mailbox confirmation.
- `PBX-VOICEMAIL-ISSUER-CANDIDATE-20261024-v2.json`: private loopback candidate.
- `PBX-VOICEMAIL-ISSUER-ONE-USE-20261024-v4.json`: successful two-direction API
  lifecycle check against 3028.
- `PBX-VOICEMAIL-PRIVATE-KAM-PREPARE-20261024-v1.json`: inactive configuration
  preparation and actual old-generation source properties.
- `PBX-VOICEMAIL-NATIVE-KAM-GRAMMAR-20261024-v1.json`: native parser acceptance
  for both prepared configurations using the installed image.
- `PBX-VOICEMAIL-ISOLATED-MEDIA-20261024-v1.json` and
  `PBX-VOICEMAIL-MEDIA-EXACT-ERROR-20261024-v1.json`: failed isolated fixture and
  its exact synthetic error, retained rather than overwritten.
- `PBX-VOICEMAIL-ISOLATED-MEDIA-20261024-v2.json`: successful corrected isolated
  media and modeled transaction checks.

- `PBX-VOICEMAIL-ISSUER-SWAP-20261024-v1.json`: actual 3013 replacement and
  protocol acceptance, owned pause released, rollback retained.
- `PBX-VOICEMAIL-FINAL-KAM-PREPARE-20261024-v1.json`: corrected final fenced
  and admitted configuration parser acceptance.
- `PBX-VOICEMAIL-OBSOLETE-PROBE-CLEANUP-20261024-v1.json`: graceful 3027 stop.
- `PBX-VOICEMAIL-FINAL-KAM-PREPARE-20261024-v3.json`: native parser acceptance
  with explicit startup-key materialization; live router unchanged.
- `PBX-VOICEMAIL-RTP-IDENTITY-20261024-v1.json`,
  `PBX-VOICEMAIL-RTP-PROCESS-20261024-v1.json` and
  `PBX-VOICEMAIL-RTP-HASH-20261024-v1.json`: actual relay generation,
  executable metadata and binary hash; no service changes.
- `PBX-VOICEMAIL-NATIVE-COUNTS-20261024-v7.json`: successful read-only native
  router, media relay and FreeSWITCH counters. Earlier refused diagnostics are
  retained and do not count as successful observations.
- `PBX-VOICEMAIL-ACTUAL-MEDIA-20261024-v1.json`: successful isolated media
  qualification using the actual live RTPengine image and executable hash.

## Activation scope

The routing release is scoped to authenticated local calls between **3001 and
1020**, with native Siprix SDES80 audio and terminal no-answer timeout (408).
Busy/DND, carrier inbound calls and browser-media fallback retain their existing
behavior. This is not an assertion that all PBX inbound voicemail is commissioned.

## Diagnostic findings resolved before admission

- Socket ownership spans Kamailio's native process family. Checking only the
  master missed the TCP worker's listeners.
- `/proc` maps and network tables need bounded reads through EOF. The previous
  single read falsely reported missing TLS. All 29 processes mapped the existing
  TLS module; no TLS configuration change was needed.
- FreeSWITCH's recording-only rule stops at its first false destination
  condition. The narrow qualification confirms that its later anti-action cannot
  intercept the reserved voicemail reference.
- The external profile resolves `$${external_sip_port}` to 5080 and owns the
  expected native UDP listener. The loaded public/private routing guards passed.

## Routing admitted at 10:19 UTC

The replacement router is live as `p11-kamailio`, container
`3af2eed782d432680a903b856f0a6f0c9462db4211997b7c7f385be69b7455d0`,
native PID 2828758, started `2026-10-24T09:51:37.397561874Z`, restart
policy `always`. All seven loaded FreeSWITCH routing guards passed. Runtime
and persisted maintenance gates are zero, and FreeSWITCH admission is restored.
The previous router remains stopped with restart disabled for rollback.

The initial replacement stopped at a startup race: Docker reported the process
running before its native FIFO was ready. Its attempted automatic recovery also
stopped at that readiness boundary. Call admission remained paused from about
09:51 until 10:19 UTC. A separately reviewed continuation verified the exact
running generation, full configuration, TLS, listeners, loaded routing guards,
and zero session counts before releasing the gate, persisting admission, and
resuming FreeSWITCH. It did not restart either service again. The failed original
receipt is preserved; the successful continuation has a new private proof root.

- Dispatch: `operator/PBX-VOICEMAIL-KAM-RESUME-20261024-v1.json`, exit 0 and
  cleanup confirmed.
- Native acceptance: `/var/lib/phone11-voicemail-kam-maintenance-oct24-v2/99-result.json`.
- Native acceptance SHA-256:
  `b5da1114d4438212eae4bc488b836ebd6e5036df65451abc773fd744af5b4316`.
- Packet SHA-256:
  `bf81a7b8471f30c420b67073617c2de23e408ffabc31b93e2907cc00e00b84ad`.

The relay was still pending at this routing checkpoint; activation is recorded below.
No SIP calls, recordings, or physical-device acceptance tests were performed.

## Source-only recurrence fix

A separate startup-readiness successor waits for read-only native control
acquisition after Docker reports the fixed process generation running. It retries
only a missing native path within the existing deadline, checks the same epoch
before each attempt, and closes partial process handles. Other errors are not
retried. Five focused tests passed. The historical executed packets are
unchanged; this successor was not executed on production.

Source packet: `pbx/voicemail-inbound-routing-oct24-v1/HELD-KAM-LOCAL-VOICEMAIL-CUTOVER-v8-SOURCE-ONLY.py`,
SHA-256 `e98f884875cc3f69afa0b8e3dbfb19ebc26c7ec6bf8edd44a6794723bb285eb2`.

## Relay process binding correction

The first post-admission emitter refused `UPLOAD_BACKEND_ACTUAL_NODE` before
writing a commissioning record or activating the relay. Cleanup succeeded.
The read-only follow-up confirmed the existing upload API uses Docker init PID
1666627 with a single Node child PID 1666685, sharing its container root and
cgroup. The immutable deployment loader reads a private mounted configuration
file into JavaScript's environment; `/proc`'s launch environment is not the
correct source for those settings. The deployed commissioning correction binds the Node child and
that existing loader/file without changing the API deployment.

Evidence: `PBX-VOICEMAIL-TRUSTED-INGRESS-20261024-v1.json` and
`PBX-VOICEMAIL-UPLOAD-PROCESS-20261024-v1.json`.

## Relay activation completed at 11:02 UTC

The corrected live emitter passed all native source, private credential,
loaded route and one-use protocol checks. Staging rechecked those bindings
before and after writing the reviewed service files. The unchanged relay
supervisor was then enabled with a 30-second retry schedule, including boot
enablement. The first scheduled worker exited successfully. The global hook
remains disabled; only the trusted local-fallback lane is enabled. No message
audio or private credentials were exported.

| Evidence | Result / native receipt SHA-256 |
| --- | --- |
| `PBX-VOICEMAIL-TRUSTED-INGRESS-20261024-v2.json` | Successful emitter; `e664e4f79462791e421c02ba0b8b23d65b94492af7f13cdd3add51f32f92b0f3` |
| `PBX-VOICEMAIL-TRUSTED-RELAY-STAGE-20261024-v1.json` | Staged, fresh source/gate and cleanup confirmed; `c7a5f2596b8a8659d64cdeefe6403cad0e975597bb3f5f0a2d84f390004cc11d` |
| `PBX-VOICEMAIL-TRUSTED-RELAY-ACTIVATE-20261024-v1.json` | Enabled/active; `9e122ac03a9119afd833be5c155705233393a5e800a08f3c14c83a454254da6b` |
| `PBX-VOICEMAIL-RELAY-OBSERVE-20261024-v1.json` | One completed pass, exit 0, no refused passes; delivered/quarantined/retry all 0 |
| `PBX-VOICEMAIL-3028-CLEANUP-20261024-v1.json` | Temporary issuer probe stopped with exit 0, retained, restart off; live 3013 unchanged |

Evidence files and operator sources are retained under
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/`.
Current aggregate state is `operator/PBX-COMMISSIONING-PROGRESS-20261024-v1.json`.

Root ran 51 relay tests successfully after the backend binding correction.
Independent source review approved the corrected backend binding and previously
approved the routing continuation, successor receipt chain and unchanged
activation lifecycle. The staging, activation and aggregate observation each
returned exit 0. No physical-phone, SIP ingress, recording, WAV finalization,
mailbox-delivery or playback acceptance is claimed. Carrier inbound, busy/DND
and browser fallback remain outside this scoped release.

## Retained recovery path

The old router, old issuer and temporary probe remain stopped; their private
evidence and configuration are retained. The relay's reviewed disable command
stops future scheduling and waits for worker quiescence without killing a worker
or deleting its outbox. Use the exact staged receipt above; do not restore an old
outbox snapshot or rerun completed mutation packets. A service restart/reboot
test was not performed.
