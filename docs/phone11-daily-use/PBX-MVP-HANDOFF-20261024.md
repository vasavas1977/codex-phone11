# Phone11 PBX MVP operational handoff — updated 25 October 2026

The ordinary management API now uses the restricted PostgreSQL 16 role, the
reviewed PBX migrations are applied, and the scoped local voicemail route and
trusted relay are enabled. The installed relay recovery guard passed two fresh
scheduled runs with zero refusals and zero delivered, retry or quarantined
items. This establishes configuration and worker operation; actual voicemail
delivery, playback and host cold-boot recovery remain unaccepted. The legacy
backend on port 3000 still uses its original broad database login. Call-record
submissions now select the dedicated receiver on port 3030, with a restricted
TLS database role and restart-always policy. Its production qualification and
FreeSWITCH URL/module transition passed without a service restart. Automatic
real-call delivery and a full host reboot remain untested.

Keep the **60-second Siprix trial**. Android and physical-phone testing remain
deferred. This handoff supersedes the earlier MVP scope record's missing-schema,
ordinary-API-superuser and inactive-voicemail statements with the receipts below;
it does not renew acceptance for other domains or authorize additional changes.

## Accepted deployment state

| Component | Accepted evidence and limit |
| --- | --- |
| PBX database | The 23 October extension-tenant, advanced-routing, phone-number and site migrations were applied. Metadata verification found twelve new empty tables and six expected capabilities. The exact fresh pre-DDL backup was restored into isolated PostgreSQL 16.13 on 25 October Bangkok time: 70 tables, 20 sequences and 9 functions; archive ownership/ACL commands replayed successfully. The temporary clone was removed. Original global roles/memberships and effective-privilege equivalence remain outside that proof. The earlier separate archive also had migration replay proof. |
| Ordinary management API | Main `/api/trpc/` and the two voicemail recording routes target loopback **3026**. Its role `p11_management_runtime_20261023_v1` has explicit grants, verified TLS, and no superuser, create-database, create-role, inheritance, replication or bypass-RLS privileges. Wrong-password, plaintext and untrusted-CA checks were rejected. Restart policy is `unless-stopped`; restart/reboot recovery was not exercised. |
| Call-record receiver | At 04:28–04:32 Bangkok on 25 October, the dedicated 3030 receiver passed production UID/source, restricted role, strict TLS and negative HTTP/auth checks. Restart `always` was enabled without restarting it. FreeSWITCH's CDR URL changed from 3000 to 3030 after owned pause and twice-zero call counts; unforced reporting-module reload and admission resume passed. Old backend remains running. Future automatic CDR delivery and historical error-spool replay are not proven by configuration. |
| Exact API artifact | Image `sha256:17b8553fb5ad57b5c766b8396f0dd65bdaea11d8b1593003264a8504578d3d62`; installed bundle `e1c270e67b1f6d4bc3ed484a74a90c3143cc3b6ddb8db5698208173988c60e5b`. The inherited health build marker identifies the base source; use the derivative manifest and installed bundle for this release. |
| Directory/issuer and FreeSWITCH | Directory and local fallback issuer/redemption remain on **3013**. The replacement issuer passed one-use protocol and directory-auth checks in both directions. The 23 October immutable FreeSWITCH replacement and loaded guards passed; original recording/voicemail volumes and outbox were preserved. These are protocol/configuration checks. |
| Local voicemail route | The replacement Kamailio router is admitted with runtime and persisted maintenance gates zero; FreeSWITCH admission is restored. Scope is authenticated local **3001 ↔ 1020**, native Siprix **SDES80**, terminal no-answer **408**. Both personal mailboxes were enabled through the signed-in admin portal. Busy/DND, carrier inbound and browser fallback retain their previous behavior and are outside this release's acceptance. |
| Nginx recovery | On 25 October Bangkok time, an owned systemd drop-in set `Restart=on-failure` and `RestartSec=5s`. Daemon reload and exact readback passed with MainPID 2045591, startup commands and existing 5 starts/10 seconds limits unchanged. The service remained active/enabled; no nginx restart, nginx config reload or host reboot occurred. This is loaded recovery policy, not an induced-failure or cold-boot test. |
| Trusted relay | The trusted local-fallback lane is enabled with a boot-enabled timer and 30-second retry schedule. The global voicemail hook remains off. The 12:17 UTC observer found the timer active/waiting and its last oneshot worker exited successfully; an inactive/dead oneshot between passes is expected. Its bounded observation is not continuous monitoring and did not enumerate the outbox or read audio. |

Protected outbound policy, mutual TLS and the synthetic CDR receiver/persistence
results remain separately recorded in the earlier deployment handoff. The
ordinary API's restricted role does not establish whole-stack least privilege:
legacy services retain their existing roles. Synthetic CDR persistence does not
prove automatic delivery from the production switch. On 25 October, an unchanged
record captured from an isolated native switch was accepted by the live receiver,
read back with its leg and three events, and removed by exact fixture ownership.
Certificate rotation remains due before
**18 December 2026**; the recorded certificates expire **17 January 2027**.

## Authoritative receipts

These are local operational records; open the linked result before using a
historical generation or configuration pin for a later action.

| Evidence | Local record |
| --- | --- |
| Latest scoped progress | [Current configuration and remaining boundaries](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261025-v20.json) |
| Restricted CDR activation | [Qualified running receiver](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-ACTIVATION-CONTINUATION-20261025-v2.json) |
| CDR automatic restart | [Policy applied without process restart](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-RESTART-PROMOTION-20261025-v1.json) |
| Native CDR destination | [URL switch and admission resumed](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-NATIVE-CDR-SIDECAR-TRANSITION-20261025-v2.json) |
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
- Actual host reboot recovery and whole-stack least privilege remain unproven.
  Do not infer them from restart policies or one service's restricted role.
  The exact fresh pre-DDL archive restore is now proven as recorded below.

Continue with bounded read-only API/operational verification and source work.
Any later call, restart, routing expansion or restoration needs its own current
target evidence and applicable owner authority. Full production, provider and
device acceptance remain separate.

## Source follow-up completed in this continuation

The static admin portal was subsequently published at source
`fd45c0d34c63d703b08083e6fe9c209aa25fcb77`. Expired admin sessions now offer an
explicit Sign in action; permission and transport failures retain their own
recovery behavior. Exact-source CI, publication preparation, activation,
independent public-file fingerprints and a signed-in voicemail-page reload
passed. The previous static release `34a2ea092f8ff21c7e649dd26176109b1929ee3d`
is retained. This publication did not restart the PBX or change its database.
See [the publication and PBX progress record](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261024-v4.json).

The startup readiness recurrence fix now propagates partial FIFO/Gate cleanup
uncertainty and refuses readiness acquired after its deadline. Its v9 held packet
`1433c846f51278fd9564e491bc2556f95e7d19ff3bdfc9798e316cad29bb96f8`
passed independent source review, 56 targeted tests, and 12 embedded-packet
readiness cases. It has not been executed on the running router; no restart was
needed. Existing synchronous-read timeout limits remain.

The relay backend-binding helper gained 15 focused regressions; all 66 relay
tests passed. These source checks do not add live delivery acceptance.

## 25 October continuation

The bounded relay observation at **17:22 UTC on 24 October** (00:22 Bangkok on
25 October) again found the timer enabled/active, the last worker successful,
eight accepted passes and zero refused passes. Latest delivered/retry/quarantine
counts remain zero. This is worker-health evidence, not voicemail delivery.

A metadata-only census at 17:27 UTC found the six selected legacy/management
services stable, with their existing restart policies and zero Docker restarts.
It did not inspect database logins or role attributes. The legacy backend's
historical elevated configured login cannot be promoted to a fresh assertion
about its active application pool. Remaining services need exact deployed SQL
and role attribution before dedicated least-privilege logins can replace them;
no shared database-owner permissions were changed.

The committed call-record template no longer contains the stale port 3001
endpoint, unsupported placeholder header or ordinary public error-log path.
It is explicitly uncommissioned. The historical generic Terraform deployment
now stops before AWS because it lacks a reviewed private runtime configuration
mount; inserting credentials into tracked source cannot qualify that mount.
The standalone preflight checks private configuration shape only. Six offline
contracts, shell syntax and independent source review passed. The accepted live
private configuration was not replaced, and native producer delivery remains
unproven. Source commit: `05e6637`.

Operational evidence:

- [Fresh relay observation](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-VOICEMAIL-RELAY-OBSERVE-20261025-v1.json)
- [Runtime census](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-LEGACY-RUNTIME-OBSERVE-20261025-v1.json)
- [Legacy-access evidence and remaining binding requirements](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-db-access-oct25-v1/README.md)
- [Reviewed call-record source handoff](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/cdr-completion-oct25-v1/SOURCE-HANDOFF.json)

### Fresh archive restore completed

At **17:51 UTC on 24 October** (00:51 Bangkok on 25 October), the exact
318,703-byte pre-DDL archive `2380124e…` restored successfully into a new,
network-isolated PostgreSQL 16.13 container using the production image digest.
`pg_restore --create --exit-on-error` returned zero. The restored catalog held
70 public tables, 20 sequences and 9 functions; archived owner/ACL commands
replayed and owners resolved. The clone was removed, archive custody and
closure checks passed, and all protected production process identities stayed
unchanged. No production SQL writes or customer-data export occurred.

This closes restoration of that exact archive. It does not establish original
global-role attributes/memberships, historical ACL equality, effective privilege
equivalence, current production-row equality or a live rollback. An earlier
attempt stopped during clone readiness and cleaned up; its precise native
failure remains unclassified. The accepted successor waits for the final
PostgreSQL process and SQL readiness, handles only the exact archive's larger
input, and omits a separate TOC stdin pass. The original subprocess helper's
limits remain unchanged. The successor passed 31 tests and independent review.

- [Successful restore receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-FRESH-BACKUP-RESTORE-20261025-v3.json)
- [Preserved first-attempt receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-FRESH-BACKUP-RESTORE-20261025-v1.json)
- [Reviewed successor scope](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/backup-restore-oct25-v1/README-v3.md)

The 60-second trial remains. Android, physical-phone acceptance, native call
record delivery, and actual voicemail recording/delivery/playback are not closed
by this backup proof.

## Legacy access and recovery follow-up (25 October)

A fresh metadata-only database session observation at 18:03 UTC on 24 October
found the legacy port-3000 service using role OID 10 with superuser, role/database
creation, replication and RLS-bypass privileges, without TLS. The other four
bridge-service addresses had no current target-database session, so their active
pool identities remain unknown. This does not invalidate the separately
commissioned restricted port-3026 role. Kamailio's host-network pool was not
attributed by the bridge-address observer.

The exact deployed legacy bundles were captured privately, with matching
container/image/process epochs before and after: port 3000 `57e80eca…` and port
3013 `829c8b9a…`. The next database priority is a dedicated, nonowner TLS login
for the actual port-3000 API and worker surface. Its required tables, sequences,
functions, lazy DDL and effective PUBLIC grants must be accounted for before
changing the pool; do not revoke the shared owner while legacy consumers still
use it. A source-only port-3013 route gate exists, but its narrower authority
function design is deferred rather than becoming a prerequisite for reducing
port-3000 superuser access.

Maintained source commit `5398149` removes the directory query's wildcard and
unused forwarding columns, and rejects duplicate matching SIP identities instead
of choosing the first. Six new real-handler tests plus 36 adjacent fraud-policy
cases pass; the backend bundle builds and independent review found no P0-P2
issue. The current port-3013 bundle already has a narrow directory projection.
This maintained-source change has not replaced any running service.

The native CDR prerequisite observation passed: `mod_xml_cdr` and `mod_loopback`
are loaded, disk and served configuration agree, and the expected private
loopback URL, credential equality, timeout/retry policy and private error spool
predicates pass. This does not inspect the module's cached globals or prove
native delivery. The actual legacy backend's event listener can notify portal
clients about native synthetic channels, so further producer qualification uses
an isolated switch rather than originating on the live switch.

The first reboot readiness observation returned `RUNTIME_OR_MOUNT_DRIFT` while
checking a broad container census. The receipt does not identify the exact
changed field, so its cause remains unclassified.
Its captured fixed-unit information remains useful, but is not a successful
reboot admission. Both native samples had zero FS calls, dialogs and RTP sessions,
but one current/waiting SIP transaction; ingress was not fenced. The successor
observer is limited to ten commissioned services. No host reboot occurred.

Operational receipts (private local evidence):

- [Database session attribution](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-LEGACY-SESSION-ATTRIBUTION-20261025-v1.json)
- [Native CDR prerequisites](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-NATIVE-CDR-PREFLIGHT-20261025-v1.json)
- [Preserved first reboot observation](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-REBOOT-READINESS-PREFLIGHT-20261025-v1.json)

The 60-second trial remains; Android and handset acceptance stay deferred.


### Relay recovery guard installed

At 18:27 UTC on 24 October (01:27 Bangkok on 25 October), the reviewed relay
startup guard `387b0e70…` was installed through an owned systemd drop-in. It
accepts a fresh process start only while the fixed container, image, complete
configuration, mounts and runtime artifacts still match. The original base unit,
timer and guard remain retained. Only relay scheduling was briefly stopped;
no call service or container restarted and no host reboot occurred.

The first staged attempt refused before changing the timer. A bounded diagnostic
then established that Docker returned the same complete mount rows in a different
order for both backend and switch. The successor sorts full rows by unique mount
destination; it still rejects changed mount values or duplicate destinations.
The failed attempt was preserved and a new operation directory used.

A subsequent read-only observer verified the effective installed command,
private install receipt, enabled timer and two **new** scheduled successful
passes, with zero refusals. Latest delivery/retry/quarantine counts were all zero.
This closes installation and scheduled operation of the recovery guard, not
actual cold-boot recovery or voicemail delivery.

- [Installed recovery guard](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-RELAY-REBOOT-GUARD-INSTALL-20261025-v2.json)
- [Scheduled successor passes](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-RELAY-REBOOT-GUARD-OBSERVE-20261025-v2.json)
- [Mount-order diagnosis](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-RELAY-EPOCH-MOUNT-DIAGNOSTIC-20261025-v1.json)

The current legacy backend's creation and actual-process worker conditions agree:
chat notifications, media retention, recording capture, recording analysis,
recording retention and event-listener prerequisites are configured. These are
configuration predicates, not proof that each worker has run. The catalog read
found no PUBLIC relation privileges or PUBLIC-executable security-definer
functions within its observed scope; audit and fraud relations use RLS. A
restricted-login transition must preserve those workers and account for RLS and
lazy provisioning DDL. No legacy login or privileges have yet changed.

- [Current worker conditions and catalog](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CURRENT-3000-WORKER-CATALOG-20261025-v1.json)


### Provisioning schema privileges: source prepared

Commit `24adb19` replaces request-time provisioning schema creation/alteration
with a read-only catalog check. It checks the seven required public tables,
required column types and search-path resolution, accepts compatible text/varchar
columns, and refuses missing or incompatible schema before writes. Failed checks
clear the existing initialization promise so a corrected migration can be retried.
Schema changes remain a separate migration operation.

Independent review accepted the source. The focused schema suite passed 19/19
against an owned PostgreSQL 17.11 fixture, including missing tenancy, incompatible
columns, views, generated columns, search-path shadows and recovery. The backend
bundle, scoped lint and diff checks passed. Full-project TypeScript checking still
fails in unrelated Electron and other existing files; it is not reported green.
No GitHub run was found for this commit during the check. These are source and
local-fixture results, not a deployment or a completed legacy-login transition.

### Native call-record isolation: failure retained

The disposable switch's third bounded attempt returned
`ERR_DESTINATION_OUT_OF_ORDER`, produced no native HTTP form, and was removed
with its owned temporary resources. Production process identities remained
unchanged. Its retained console contained four core SQLite bootstrap errors;
these alone do not establish the originate failure's cause. No call was placed
on the production switch and no handset or carrier was contacted. Native CDR
producer delivery and real API ingestion remain unproven.


The subsequent exact-image PostgreSQL 16 rehearsal passed at 18:54 UTC on
24 October (01:54 Bangkok on 25 October). An isolated restore plus the five
reviewed migrations supported the captured legacy provisioning functions using
a real restricted SCRAM login over verified TLS. Ten forbidden operations,
`FOR SHARE` without an UPDATE grant, bad passwords, plaintext connections and
untrusted certificates were denied. The unassigned-account read and read-only
schema check passed. Both temporary containers were removed and production
process identities remained unchanged. This does not qualify assigned SIP
credential reads or all API/background-worker privileges.

- [Exact-image PG16 restricted read proof](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-3000-PROVISIONING-READ-20261025-v1.json)

The fourth isolated native CDR attempt corrected the fixture's session-rate
budget from one to two while retaining a two-session maximum and one originate
command. It returned the expected successful UUID and captured a native HTTP
form, but the strict fixture parser refused it. Cleanup was confirmed; raw data
remains private for diagnosis. Capture alone is not accepted delivery.


The fifth isolated attempt passed at 19:01 UTC on 24 October (02:01 Bangkok
on 25 October). The fixture supplied its destination as a channel variable;
the strict parser was unchanged. The exact deployed FreeSWITCH image emitted
an 8,873-byte native form, the local receiver accepted it with HTTP 200, the
expected UUID completed with zero billable seconds, and the clone returned to
idle before cleanup. Protected production epochs remained unchanged. The
record's fixture tenant is 2147483647: it must not be retagged or posted to the
live API under tenant-1 authority. This closes isolated native emission and
receiver acceptance, not the joined native-to-production-database path.

- [Native producer and strict receiver PASS](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-ISOLATED-NATIVE-CDR-QUALIFICATION-20261025-v5.json)


The assigned-authority successor also passed on exact PG16 at 19:03 UTC.
Three reserved synthetic account/workspace fixtures were created only in the
owned restored clone. Captured legacy code selected the expected synthetic
subscriber credential privately and executed its unchanged workspace `FOR SHARE`
query. Wrong tenant, inactive membership, deleted extension and unassigned user
were denied. Nineteen forbidden operations and the transport negatives passed.
The role had only four explicit UPDATE columns needed for row-lock privileges;
those columns are writable, so this is not a total-DML-denial claim. Both clones
were removed and production identities remained unchanged.

This qualifies the subscriber-password fallback and authority query execution,
not encrypted-secret decryption, retained concurrent locks, all auth/worker
operations or a production login switch. The remaining actual legacy dependencies
include its installed auth adapter writes, role-specific audit/fraud RLS,
enabled recording/chat worker cycles, and missing optional schema objects.

- [Assigned authority PG16 PASS](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-3000-ASSIGNED-AUTHORITY-20261025-v2.json)
- [Actual legacy permission requirements](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/ACTUAL-3000-TRANSITION-DELTA.md)

### Native record through the live receiver: accepted

At 19:17 UTC on 24 October (02:17 Bangkok on 25 October), the unchanged
8,864-byte native tenant-1 record from the sixth isolated capture was posted once
to the current authenticated CDR endpoint. HTTP 200 was followed by exact database
readback of the parent, leg and three timestamped start/answer/hangup events.
Ownership and recording fields were empty, billable seconds were zero, and no
recording route, wake link or cloud-recording association was observed. The three events, leg and parent
were removed under exact ownership checks; database closure and process stability
were confirmed. Sequence/WAL effects are not undone by row cleanup.

The original tenant-2147483647 fifth capture was not retagged or reused. This
proves native serialization through the current live receiver and database. It
does not exercise automatic posting by the production switch, customer calls,
voicemail audio, or phones. Separate review found a legacy reliability limitation:
event inserts happen after the main transaction, and a completed-leg retry skips
missing events. This run proved all three events persisted, but does not fix that
failure path.

- [Native capture and live persistence](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-NATIVE-CDR-API-HANDOFF-20261025-v1.json)
- [Current progress and remaining scope](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261025-v5.json)
- [Actual auth adapter permission boundary](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/AUTH-ADAPTER-PERMISSIONS.md)

### Voicemail owner changes: component integration accepted

The owned PostgreSQL 17.11 integration run passed all six required cases with
zero skips. Two added cases exercise the real owner-epoch admission route,
producer, relay, storage and authorized playback together. A stale upload after
mailbox reassignment returns 409, is quarantined, retains its local WAV, and
creates no message or stored media. A fresh deposit belongs to the replacement
owner; the former owner receives 404 for that new message. Historical messages
retain their deposit-time ownership.

The runner requires these exact six cases. Its database used only a private Unix
socket; the owned process and temporary data root were removed. Scoped lint and
diff checks passed. These are source-component results with synthetic principals,
not live phone ingress or production mailbox-delivery acceptance.

- [Six-case voicemail integration evidence](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/voicemail-delivery-oct25-v1/SOURCE-VALIDATION-v1.json)

## Call-event retry repair — source only

The native receiver proof exposed a separate failure path: event insertion errors
were swallowed after committing the call and leg; completed-leg retries then
skipped all events. The source now reconciles missing event identities in a
separate transaction, locking the exact tenant's parent and leg in the established
order. Event-store errors propagate to the webhook's existing HTTP 500 response
while preserving the committed call facts. A later identical delivery repairs
missing events without duplicating already stored ones.

The isolated PostgreSQL 17.11 suite passed all eleven cases, including concurrent
retries, unavailable event storage, repair of a previously partial event history,
and a late event failure that rolls back the event batch. Seventeen focused input
and ownership tests passed. Scoped lint had no errors and seven existing warnings.
The private Unix-socket database was stopped and removed. This source change has
not replaced the live legacy receiver. Its current native producer has retries=0
and a private error spool; this change does not establish automatic live replay
or accept the spool recovery path.

Evidence: [local event retry result](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/cdr-retry-oct25-v1/LOCAL-PG-RESULT-v1.json).

## Legacy authentication permission boundary

The actual installed BetterAuth 1.7.3 permission paths were captured read-only
from the current legacy backend, including its exact PostgreSQL adapter binding.
The source-derived minimum permits existing-column SELECTs, session and rate-limit
INSERT/DELETE, and UPDATE only on session expiry/update timestamps and rate-limit
count/window timestamps. The allowed email sign-in path does not require writes
to auth users, credential accounts, canonical users or identity mappings. No auth
sequence, schema-create, ownership or RLS-bypass grant follows from these paths.
DELETE remains relation-wide; application predicates provide its scope.

The exact installed authentication functions subsequently passed isolated
PostgreSQL 16.13 qualification at 19:54 UTC on 24 October (02:54 Bangkok on
25 October). Actual sign-in, canonical identity resolution, persisted session
refresh/expiry/revocation and database rate-limit reset/pruning passed with the
proposed restricted role. Twelve prohibited operations and wrong-password,
plaintext and untrusted-CA connections were rejected. The application and database
clones were removed, and protected production processes stayed unchanged.

Enabled worker permissions and applicable audit/fraud RLS still need qualification
before changing the production pool. The legacy backend still uses its existing
login. No customer credentials or session values were exported.

Evidence: [installed permission sources](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-INSTALLED-AUTH-SQL-SOURCE-CAPTURE-20261025-v4.json),
[permission matrix](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/AUTH-ADAPTER-PERMISSIONS.md),
[nginx policy installation](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-NGINX-RECOVERY-INSTALL-20261025-v1.json).


### Source recovery guard aligned with the installed release

The repository relay supervisor now matches the installed recovery guard byte for
byte (`387b0e70…`). The explicit trusted lane can accept a fresh process after a
restart of the same immutable container and image. Both ends of each check must
agree on its process, complete creation configuration, host configuration and
complete mount rows. Mount order is normalized by unique destination; duplicate
or changed mounts are rejected. The default legacy lane retains exact start-time
binding. Artifact, protocol, owner-epoch and private evidence checks still apply.

All 33 focused supervisor tests passed, including restart-in-progress, process or
configuration drift, reordered mounts, duplicate mounts, private error output and
no queue processing during metadata checks. This source synchronization does not
restart services or claim an actual host reboot.

The exact legacy CDR derivative also passed eight real PostgreSQL 17 cases across
30 READ COMMITTED transactions. The rest of the deployed bundle is unchanged.
Parsed input and recording-route binding were injected for this isolated test;
HTTP authentication, parser and production worker behavior were not exercised.
The derivative is prepared, not deployed.

- [Actual installed authentication PG16 proof](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-AUTH-QUALIFICATION-20261025-v1.json)
- [Exact legacy CDR derivative database proof](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/cdr-retry-oct25-v1/candidate/REAL-PG17-QUALIFICATION-v1.json)

## Actual recording worker permissions — 25 October continuation

The installed legacy recording analysis and retention functions passed against
the exact deployed application image and an isolated PostgreSQL 16.13 restore.
The dedicated clone login had explicit column grants on five tables, verified
TLS, no ownership/memberships, and no elevated role attributes. Actual job claims,
completion, retry exhaustion, tenant/token/expiry rejection, policy locks,
concurrent claim exclusion, and owned-file retention cleanup passed. Fifteen
forbidden database operations and wrong-password/plaintext/untrusted-CA logins
were rejected. The policy timestamp UPDATE privilege is intentional for
`FOR SHARE`; it permits timestamp writes and is not described as read-only.

Only synthetic jobs and files were processed; analysis used an injected
deterministic result, with no provider calls. The exact three worker tables were
reset only inside the disposable restored clone after schema, collision, trigger
and foreign-key checks. Both owned containers were removed, archive custody
remained stable, and all protected production process identities were unchanged.

This closes the analysis/retention permission slice. Chat qualification also
passed as recorded below; capture database qualification subsequently passed,
while its upload sink and remaining HTTP paths still require qualification
before changing the live legacy login.
It is not customer voicemail delivery, an AI-provider test, or a production
permission cutover. Trial remains 60 seconds; Android and phone testing are deferred.

- [Installed-image PG16 worker receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-RECORDING-WORKERS-20261025-v1.json)
- [Independent packet review](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/worker-qualification-recording.independent-review.json)

## Notification and media-cleanup permissions — 25 October

The installed notification repository/dispatcher and chat-media cleanup passed
with a restricted login against the exact application image and an isolated
PostgreSQL 16.13 restore. Actual dispatch authorization, device revision checks,
invalid-token deletion, queue pruning, concurrent claims, media locks and
owned-file cleanup passed. Seventeen prohibited operations plus wrong-password,
plaintext and untrusted-CA logins were rejected. Eight focused packet checks and
exact source/manifest assembly also passed.

The sender was inert: no APNS request was sent. Only synthetic queues and files
were processed; both clone containers were removed and production processes
remained unchanged. The attachment timestamp UPDATE grant permits writes and is
required by the existing row-lock query. Existing notification predicates do not
check message deletion, so deleted-message exclusion is not claimed. Media-file
removal before a database commit is not an atomic filesystem rollback.

This qualifies the worker slice, not the remaining legacy HTTP paths or
a live database-login replacement. Trial remains 60 seconds; Android and phone
tests are deferred.

- [Installed-image PG16 chat-worker receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-CHAT-WORKERS-20261025-v1.json)

## Capture worker database permissions — 25 October

At 20:50 UTC on 24 October (03:50 Bangkok), the captured production capture
worker passed against the exact application image and an isolated PostgreSQL
16.13 restore. Thirty-one unchanged definitions exercised inbound/outbound
correlation, provisional call records, ownership rejection, capture leases,
policy and recording locks, expiry handling, and a finite reconciliation pass.
The restricted clone role used column grants on ten tables and USAGE on two
sequences. All 23 forbidden SQL operations and three negative login checks were
rejected. Eight focused source checks and Node syntax also passed.

ESL and spool transports were inert; no recording command, phone call or upload
request occurred. An upload result without persisted storage was rejected, but
the actual authenticated upload sink remains unqualified. Only owned synthetic
records were processed after guarded clone-only fixture preparation. Both
containers were removed and protected production processes stayed unchanged.
This completes the capture **database** slice, not the full legacy permission
cutover or real recording/voicemail delivery. The live legacy login is unchanged.

- [Installed-image PG16 capture-worker receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-CAPTURE-WORKERS-20261025-v1.json)

## Call-record receiver qualification history — resolved by the current deployment

The exact production-image CDR-only candidate passed its seventh isolated PG16
HTTP qualification at 20:52 UTC on 24 October. Actual authenticated HTTP requests,
assigned and ownerless call graphs, replay and missing-event repair, tenant/SIP
rejections, 20 denied database operations and strict TLS login negatives passed.
All 18 fixed graph readbacks passed, and both temporary containers were removed.
The policy row-lock negative also confirmed that HTTP 200 alone does not prove a
cloud-recording row was created. This is receiver qualification, not automatic
production switch delivery or handset acceptance.

The first production stage created the dedicated CDR role with login
disabled and created its container in the stopped state. It refused during the
Docker configuration comparison. A read-only diagnostic classified additional
environment entries and health-check fields, then refused its final epoch check.
The original failed stage receipt is retained. At that step, no candidate start,
HBA change, login enablement, native CDR destination change or legacy restart
occurred. The reviewed continuation and later partial activation are recorded
below; do not replay the original stage. The legacy database login is unchanged.

- [Exact-image HTTP qualification](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-CDR-SIDECAR-HTTP-QUALIFICATION-20261025-v7.json)
- [Stopped-stage result](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-STOPPED-STAGE-20261025-v1.json)
- [Progress at the original stopped stage](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261025-v13.json)

### Later CDR continuation, scoped HBA and partial activation

At **04:07 Bangkok on 25 October** (21:07 UTC on 24 October), the reviewed
continuation admitted the same existing stopped candidate and NOLOGIN role,
verified exact image-default environment/health-check merging, and preserved the
original failed receipt. It recreated neither the role nor the container. At
04:12 Bangkok, scoped HBA v5 installed nine role-specific rules and verified one
reload, preserving all other HBA bytes and protected process epochs. The role
still had NOLOGIN and the candidate had not started at that boundary; actual
authentication remained unproven.

At **04:14 Bangkok**, activation v1 committed LOGIN for only the dedicated CDR
role and dispatched one candidate start, then refused at `START_ONCE` with
`RUNNING_DEFINITION_DRIFT` (exit 70). `loginOutcomeUnknown=false`, but
`startOutcomeUnknown=true`: the receipt does not qualify the running definition,
health, UID/source binding, TLS or negative HTTP checks. Retain the candidate and
journals for bounded diagnosis; do not replay activation or infer successful
startup. Native CDR still targets the existing port 3000 receiver, and the old
backend/login is unchanged. No host reboot or phone/Android test occurred.

- [Stage continuation PASS](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-STAGE-CONTINUATION-20261025-v2.json)
- [Scoped HBA v5 PASS](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-SCOPED-HBA-20261025-v5.json)
- [Partial activation v1](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-ACTIVATION-20261025-v1.json)

At **04:19 Bangkok**, the read-only runtime diagnostic confirmed that the same
candidate is running with LOGIN enabled, no elevated role flags, restart count
zero and restart policy `no`. UID 1001, Node executable, all four private/source
file inodes, fixed network and 16 MiB noexec tmpfs matched. The only Docker
configuration change was `HostConfig.OomKillDisable` from `false` while stopped
to `null` while running. This diagnosis does not yet admit full activation;
HTTP and native TLS checks still require the reviewed continuation. Original
failed activation evidence remains intact.

- [Current runtime diagnostic](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-ACTIVATION-DIAGNOSTIC-20261025-v2.json)

The first continuation at 04:22 Bangkok passed HTTP health/auth/parser and
native process/file checks, then refused its database identity comparison before
writing continuation evidence. The 04:26 read-only diagnostic confirmed positive
TLS and every role/permission predicate; only address formatting differed:
`inet_*_addr()::text` included `/32`. The corrected verification uses PostgreSQL
`host(inet_*_addr())` while keeping the exact expected IP addresses and all TLS
negative checks. This changes the verifier, not the deployed receiver or grants.

- [First continuation, no evidence writes](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-ACTIVATION-CONTINUATION-20261025-v1.json)
- [Positive TLS identity diagnosis](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-CDR-SIDECAR-AUTH-IDENTITY-DIAGNOSTIC-20261025-v1.json)

At **04:28 Bangkok**, corrected continuation v2 passed all native identity,
strict TLS and negative-authentication checks and wrote the distinct successful
continuation receipt while preserving original failures. At **04:29**, restart
policy changed from `no` to `always` without changing process epochs. At
**04:32**, FreeSWITCH's URL-only transition to port 3030 completed: owned pause,
twice-zero counts, exact inode-retaining XML exchange, unforced module reload
and resume were confirmed. No service restarted and no call was placed. The
current deployment receipts above supersede the incomplete activation state in
this historical sequence; they do not establish real call or cold-boot acceptance.

### Delivery restart boundary

The pinned voicemail relay retains its manifest and source WAV on 503, network
failure or timeout for later scheduled scanning; 400/404/409 move the manifest
to private quarantine. The timer schedules after activation and inactive passes
at 30 seconds. Its observed empty passes do not prove queued delivery through a
boot-time database/HTTP outage. Sequential retries and an infinite oneshot
timeout provide no bounded recovery-time guarantee. The native CDR error spool
is separate and has no automatic replay established by this evidence. See the
[source-bound restart gap/runbook note](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/reboot-recovery-oct25-v1/DELIVERY-RESTART-GAPS-v1.md).
The 60-second trial, deferred phone/Android tests, and unaccepted real
recording/voicemail delivery and full cold-boot recovery remain unchanged.

### Actual recording-upload database boundary — 25 October, 04:37 Bangkok

The installed recording-upload HTTP handler and its retained ingestion SQL passed
on the exact legacy application image against the isolated restored PostgreSQL
16.13 database. The restricted role uses explicit column permissions on ten
relations with no sequence permissions. Actual authenticated HTTP, file bytes
and owner-private mode, replay without replacement, CDR URL, cloud recording
readiness/storage and queued-job readback passed. All 21 forbidden SQL operations
and wrong-password, plaintext and untrusted-CA connections were rejected. Both
owned clones were removed; protected production processes and the archive stayed
unchanged. No production grants or login were changed.

This exposed, rather than fixed, an existing ownership limit: disabled or
ambiguous owner validation occurs after file and CDR URL writes. The handler
returns HTTP 200 with `analysisQueued:false` but no ready cloud recording or job.
The rehearsal explicitly required that outcome and does not count HTTP 200 as
delivery acceptance. A pre-storage ownership fix remains necessary before the
endpoint transition. AI-off uploads similarly report ingestion accepted without
creating an analysis job; that separate behavior was verified by readback. Native
upload transport, actual voicemail delivery and cold-boot recovery remain open.

- [Exact-image PG16 upload receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-ACTUAL-UPLOAD-SINK-20261025-v1.json)
- [Scope, permissions and known behavior](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/upload-qualification-oct25-v1/README.md)

### Native failed-call-record queue — 25 October, 04:39 Bangkok

A bounded read-only observation found **zero entries and zero bytes** in the fixed
private native CDR error spool, with no unexpected files or entry types. Two
metadata snapshots agreed. The host/native directory inode, root-only mode,
FreeSWITCH process epoch and retained 3030 transition configuration matched. No
spool entry was opened, exported, resent or deleted. Disk and served XML still
specify a three-second timeout and zero additional retries; cached module
parameters were not independently inspected. An empty queue at this instant
does not establish future delivery or automatic replay after an outage.

- [Private-spool metadata receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-NATIVE-CDR-SPOOL-METADATA-20261025-v2.json)
