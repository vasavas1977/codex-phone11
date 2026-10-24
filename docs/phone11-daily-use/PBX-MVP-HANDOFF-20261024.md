# Phone11 PBX MVP operational handoff — 24 October 2026

The ordinary management API now uses the restricted PostgreSQL 16 role, the
reviewed PBX migrations are applied, and the scoped local voicemail route and
trusted relay are enabled. The latest read-only relay observation completed at
12:17 UTC: eight completed passes, zero refused passes, and latest delivered,
retry and quarantined counts all zero. This establishes configuration and worker
operation; no actual message delivery or playback has been accepted.

Keep the **60-second Siprix trial**. Android and physical-phone testing remain
deferred. This handoff supersedes the earlier MVP scope record's missing-schema,
ordinary-API-superuser and inactive-voicemail statements with the receipts below;
it does not renew acceptance for other domains or authorize additional changes.

## Accepted deployment state

| Component | Accepted evidence and limit |
| --- | --- |
| PBX database | The 23 October extension-tenant, advanced-routing, phone-number and site migrations were applied. Metadata verification found twelve new empty tables and six expected capabilities. A fresh pre-DDL backup is retained. An earlier backup was restored into isolated PostgreSQL 16.13 and migrations replayed twice; the fresh dump itself has not been restored, and the earlier restore excluded ownership and ACLs. |
| Ordinary management API | Main `/api/trpc/` and the two voicemail recording routes target loopback **3026**. Its role `p11_management_runtime_20261023_v1` has explicit grants, verified TLS, and no superuser, create-database, create-role, inheritance, replication or bypass-RLS privileges. Wrong-password, plaintext and untrusted-CA checks were rejected. Restart policy is `unless-stopped`; restart/reboot recovery was not exercised. |
| Exact API artifact | Image `sha256:17b8553fb5ad57b5c766b8396f0dd65bdaea11d8b1593003264a8504578d3d62`; installed bundle `e1c270e67b1f6d4bc3ed484a74a90c3143cc3b6ddb8db5698208173988c60e5b`. The inherited health build marker identifies the base source; use the derivative manifest and installed bundle for this release. |
| Directory/issuer and FreeSWITCH | Directory and local fallback issuer/redemption remain on **3013**. The replacement issuer passed one-use protocol and directory-auth checks in both directions. The 23 October immutable FreeSWITCH replacement and loaded guards passed; original recording/voicemail volumes and outbox were preserved. These are protocol/configuration checks. |
| Local voicemail route | The replacement Kamailio router is admitted with runtime and persisted maintenance gates zero; FreeSWITCH admission is restored. Scope is authenticated local **3001 ↔ 1020**, native Siprix **SDES80**, terminal no-answer **408**. Both personal mailboxes were enabled through the signed-in admin portal. Busy/DND, carrier inbound and browser fallback retain their previous behavior and are outside this release's acceptance. |
| Trusted relay | The trusted local-fallback lane is enabled with a boot-enabled timer and 30-second retry schedule. The global voicemail hook remains off. The 12:17 UTC observer found the timer active/waiting and its last oneshot worker exited successfully; an inactive/dead oneshot between passes is expected. Its bounded observation is not continuous monitoring and did not enumerate the outbox or read audio. |

Protected outbound policy, mutual TLS and the synthetic CDR receiver/persistence
results remain separately recorded in the earlier deployment handoff. The
ordinary API's restricted role does not establish whole-stack least privilege:
legacy services retain their existing roles. Synthetic CDR persistence does not
prove delivery from the native producer. Certificate rotation remains due before
**18 December 2026**; the recorded certificates expire **17 January 2027**.

## Authoritative receipts

These are local operational records; open the linked result before using a
historical generation or configuration pin for a later action.

| Evidence | Local record |
| --- | --- |
| Database migrations | [PBX-LIVE-MIGRATIONS-20261023-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-LIVE-MIGRATIONS-20261023-v1.json) |
| Restricted API, TLS negatives and configured readiness address | [PBX-VOICEMAIL-BACKEND-RUNNING-20261023-v3.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-BACKEND-RUNNING-20261023-v3.json) |
| Main API route and later voicemail route | [PBX-COMBINED-API-ROUTE-20261023-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMBINED-API-ROUTE-20261023-v1.json), [PBX-VOICEMAIL-UPLOAD-ROUTE-20261023-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-UPLOAD-ROUTE-20261023-v1.json) |
| Database/API/FreeSWITCH aggregate | [PBX-COMMISSIONING-PROGRESS-20261023-v2.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261023-v2.json) |
| Issuer replacement | [PBX-VOICEMAIL-ISSUER-SWAP-20261024-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-ISSUER-SWAP-20261024-v1.json) |
| Failed router transition and successful continuation | [PBX-VOICEMAIL-KAM-CUTOVER-20261024-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-KAM-CUTOVER-20261024-v1.json), [PBX-VOICEMAIL-KAM-RESUME-20261024-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-KAM-RESUME-20261024-v1.json) |
| Trusted ingress, staged relay and activation | [PBX-VOICEMAIL-TRUSTED-INGRESS-20261024-v2.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-TRUSTED-INGRESS-20261024-v2.json), [PBX-VOICEMAIL-TRUSTED-RELAY-STAGE-20261024-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-TRUSTED-RELAY-STAGE-20261024-v1.json), [PBX-VOICEMAIL-TRUSTED-RELAY-ACTIVATE-20261024-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-TRUSTED-RELAY-ACTIVATE-20261024-v1.json) |
| Fresh bounded relay observation | [PBX-VOICEMAIL-RELAY-OBSERVE-20261024-v2.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-RELAY-OBSERVE-20261024-v2.json) |
| Scoped voicemail aggregate | [PBX-COMMISSIONING-PROGRESS-20261024-v3.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261024-v3.json); includes the latest bounded observer and signed-in read result |
| Earlier protected routing, boot supervision and CDR lineage | [ACTIVE-PRODUCTION-HANDOFF-20261023-v1.json](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/ACTIVE-PRODUCTION-HANDOFF-20261023-v1.json) |

## Startup incident and retained recovery

The 24 October router replacement stopped at a startup race: Docker reported
running before the native FIFO was ready. The attempted recovery also stopped
at that boundary. Admission remained paused from approximately **09:51 to
10:19 UTC**. A separately reviewed continuation verified the same running
generation, full configuration, TLS/listeners, loaded guards and zero session
counts before releasing and persisting admission. It did not restart either
service again. The failed receipt remains preserved separately from the accepted
continuation; its native success proof is
`/var/lib/phone11-voicemail-kam-maintenance-oct24-v2/99-result.json`, SHA-256
`b5da1114d4438212eae4bc488b836ebd6e5036df65451abc773fd744af5b4316`.

The old router, issuer and FreeSWITCH release/container remain retained stopped
with restart disabled. Temporary issuer probes are stopped and retained. For
relay disablement, use the exact staged receipt's reviewed command, wait for
worker quiescence and preserve its outbox; do not restore an old outbox snapshot
or kill an active worker. For API rollback, account for the later voicemail
route's site configuration before touching the main tRPC route. Do not rerun
completed mutation packets with stale pins or drop new tables as an application
rollback. Detailed recovery boundaries are in
[the database/API release](PBX-DATABASE-RELEASE-20261023.md) and
[the voicemail activation record](VOICEMAIL-INBOUND-ACTIVATION-20261024.md).

## Remaining gates

- Signed-in UI reads passed on 24 October for the 3001 account: admin overview,
  IVR menus, ring groups, queues, business hours (including reload), and voicemail.
  Voicemail reports detected inbox storage, writable audio storage and enabled
  mailboxes 3001/1020. The advanced lists are empty; no records were created or
  settings changed. This does not establish advanced writes, persisted edited
  object reload, deployed cross-tenant denials or a captured API response. See
  [the signed-in read observation](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-ADMIN-SIGNED-IN-READS-20261024-v1.json).
- Real SIP ingress, recording/WAV finalization, mailbox delivery and playback
  remain unaccepted. Empty successful relay passes do not close these gates.
  Android and physical-phone testing remain deferred; carrier routes and general
  busy/DND/browser voicemail behavior are outside the admitted local scope.
- Actual host reboot recovery, whole-stack least privilege and restore of the
  fresh pre-DDL dump remain unproven. Do not infer them from restart policies,
  one service's restricted role or the earlier backup's restore.

Continue with bounded read-only API/operational verification and source work.
Any later call, restart, routing expansion or restoration needs its own current
target evidence and applicable owner authority. Full production, provider and
device acceptance remain separate.

## Source follow-up completed in this continuation

The startup readiness recurrence fix now propagates partial FIFO/Gate cleanup
uncertainty and refuses readiness acquired after its deadline. Its v9 held packet
`1433c846f51278fd9564e491bc2556f95e7d19ff3bdfc9798e316cad29bb96f8`
passed independent source review, 56 targeted tests, and 12 embedded-packet
readiness cases. It has not been executed on the running router; no restart was
needed. Existing synchronous-read timeout limits remain.

The relay backend-binding helper gained 15 focused regressions; all 66 relay
tests passed. These source checks do not add live delivery acceptance.
