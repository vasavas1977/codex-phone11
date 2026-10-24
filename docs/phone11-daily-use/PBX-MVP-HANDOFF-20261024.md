# Phone11 PBX MVP operational handoff — updated 25 October 2026

The management API, call-record receiver and public recording-upload receiver
now use separate restricted TLS database roles. FreeSWITCH submits call records
to loopback 3030, and the exact public recording-upload route selects loopback
3031. Both receivers have restart-always policy. The bounded voicemail relay is
installed, with four observed successful scheduled passes and zero refusals;
those passes delivered zero items.

The legacy backend on port 3000 still uses its original broad database login.
Its remaining authenticated routes and background workers must move before that
login can be retired. Delivery from real calls, historical call-record recovery,
voicemail playback and actual host cold-boot recovery remain unaccepted. Loaded
restart policies and malformed-request checks do not establish those outcomes.

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
| Recording-upload receiver | Public `/api/recordings/upload` now selects loopback **3031**. The UID 1001 receiver uses a dedicated restricted TLS role; wrong credentials, plaintext and an untrusted CA were rejected. An owned harmless file proved mounted-directory write/read/removal. Nginx loaded the exact route without restart; normal HTTPS negative checks passed. Restart policy is `always`. No valid recording was submitted, and legacy upload aliases remain pending retirement. |
| Exact API artifact | Image `sha256:17b8553fb5ad57b5c766b8396f0dd65bdaea11d8b1593003264a8504578d3d62`; installed bundle `e1c270e67b1f6d4bc3ed484a74a90c3143cc3b6ddb8db5698208173988c60e5b`. The inherited health build marker identifies the base source; use the derivative manifest and installed bundle for this release. |
| Directory/issuer and FreeSWITCH | Directory and local fallback issuer/redemption remain on **3013**. The replacement issuer passed one-use protocol and directory-auth checks in both directions. The 23 October immutable FreeSWITCH replacement and loaded guards passed; original recording/voicemail volumes and outbox were preserved. These are protocol/configuration checks. |
| Local voicemail route | The replacement Kamailio router is admitted with runtime and persisted maintenance gates zero; FreeSWITCH admission is restored. Scope is authenticated local **3001 ↔ 1020**, native Siprix **SDES80**, terminal no-answer **408**. Both personal mailboxes were enabled through the signed-in admin portal. Busy/DND, carrier inbound and browser fallback retain their previous behavior and are outside this release's acceptance. |
| Nginx recovery | On 25 October Bangkok time, an owned systemd drop-in set `Restart=on-failure` and `RestartSec=5s`. Daemon reload and exact readback passed with MainPID 2045591, startup commands and existing 5 starts/10 seconds limits unchanged. The service remained active/enabled; no nginx restart, nginx config reload or host reboot occurred. This is loaded recovery policy, not an induced-failure or cold-boot test. |
| Trusted relay | The bounded replacement relay is installed at a new sibling path, preserving the old relay for rollback. Its enabled timer runs on a 30-second retry schedule. Four scheduled passes completed with zero refusals and zero delivered, retry or quarantine counts. A pass handles at most eight entries within 45 seconds, with a 60-second native watchdog. The global voicemail hook remains off. Real backlog/outage delivery and cold boot are not proved. |

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
| Latest scoped progress | [Current configuration and remaining boundaries](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-COMMISSIONING-PROGRESS-20261025-v37.json) |
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

### Failed-CDR serialization — 25 October, 04:45 Bangkok

The exact installed FreeSWITCH image was exercised in a new network-isolated
clone with one synthetic null channel and a receiver deliberately returning 503.
Its sole failed-CDR file was 8,869 bytes: exactly the URL-encoded XML portion of
the captured native HTTP form, without the `cdr=` prefix. It was not raw XML and
not the full HTTP form. The file mode was 0644 inside a root-only 0700 directory.
Only this owned synthetic file was read and retained privately; no production
spool, application API, SIP peer or customer audio was accessed. The clone and
its owned volumes were removed and protected processes remained unchanged.

This qualifies the failed-record serialization, not replay. A future replayer
must validate the encoded payload and reconstruct the original form without
double-encoding; durable acknowledgement, concurrent-file handling and deployed
recovery remain separate work. The production error queue was empty at the
earlier bounded observation.

- [Exact-image failure-spool receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-ISOLATED-CDR-FAILURE-SPOOL-FORMAT-20261025-v2.json)

### Upload owner-admission fix — source and PG16 qualified, not deployed

The maintained recording-upload handler now checks its capture-authorized cloud
owner against the unique active same-tenant call-leg owner before writing a new
file or CDR URL. Disabled/deleted owners, inactive tenants, ambiguous ownership,
unsupported call direction and cloud-owner mismatch return the existing 409.
Duplicate legs for the same owner, valid retries and the capture-disabled legacy
branch retain their behavior. No additional database privileges were introduced.

Final maintained handler tests passed **20/20**, including real local PostgreSQL
authorization SQL. The preceding related regression run passed **65/65** (18
then-current owner cases, 30 voicemail storage, 11 capture and 6 ledger cases).
The independently reviewed exact-image PG16 successor passed at 04:48 Bangkok:
authenticated HTTP, storage/job readback, owner rejection before writes, 21 SQL
denials, TLS negatives and both owned-clone cleanups. Production processes,
login, route and grants stayed unchanged. The actual installed route still needs
a qualified deployment of this fix.

This is request-time admission, not atomic revocation. Local tests with actual
repository functions demonstrate that revocation after the authorization snapshot
can still leave a file, and revocation after the repository's owner read can still
complete a ready recording/job. Replays after an already-committed revocation
are denied as new requests.

- [Exact-image owner-admission receipt](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/operator/PBX-PG16-UPLOAD-OWNER-CANDIDATE-20261025-v1.json)
- [Candidate provenance and revocation limits](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/upload-owner-fix-oct25-v1/README.md)

### Non-destructive CDR recovery engine — integrated source only

The reviewed recovery engine is now versioned under
`scripts/phone11-cdr-replay/`. Its 24 offline cases pass from the maintained
checkout. It preserves native originals, fsyncs exact payload snapshots and
intent/acknowledgement state, and rotates a persisted cursor so retained files
cannot starve later records. Known HTTP 500/503 retries are capped at three;
timeouts and interrupted intent remain blocked for reconciliation.

Independent GPT-6.1 Sol high review accepted exact worker SHA
`25cd6f8eba2d22b24e03a6c18cb5e5829cd46981a350f4ac233d269406391437`
with no P0–P2 findings. This is not an installed recovery service. Authenticated
transport, current tenant/route authority, independent producer-completion
proof and service lifecycle qualification remain required. A CDR acknowledgement
does not establish recording registration or voicemail delivery.

### Upload storage transition — live metadata verified, 25 October 05:04 Bangkok

Fresh read-only checks identify the configured recording root as
`/var/lib/phone11/recordings`, not the source fallback. It is a writable bind
mount with directory mode 0700, UID/GID 1001 matching the legacy process; the
host and container directory identities match. Selected creation/initial-process
configuration agrees, capture is enabled and its configured upload endpoint is
`https://api.phone11.ai/api/recordings/upload`. The pinned on-disk nginx closure
still selects legacy port 3000 for that path. Port 3031 had no host TCP or Docker
binding at the observation; it was not reserved.

No recording entries, audio or customer rows were read, no SQL sessions opened,
and no services or permissions changed. Loaded JavaScript configuration, loaded
nginx request selection, actual edge routing and storage-write ACL acceptance
remain separate from these metadata checks. The replacement upload receiver has
not been installed. Exact receipts are retained in the operator directory:
`PBX-UPLOAD-BIND-STORAGE-METADATA-20261025-v1.json` and its three preceding
configuration/metadata observations.

### Bounded voicemail recovery — maintained source, not installed

The maintained relay now attempts at most eight manifests per pass, with a
45-second cooperative work deadline and a 60-second native-process watchdog.
A persisted, fsynced cursor advances even when early messages retry, preventing
starvation. Enumeration admits at most 4096 data entries plus the two reserved
cursor filenames. A full admitted queue therefore does not deadlock merely
because the worker creates its cursor.

An interrupted zero-byte or partial temporary cursor is recovered only after
strict private ownership, mode, held-inode and single-link checks under the
existing external native lock. Committed cursor corruption and unsafe temporary
metadata still refuse. Original WAV data, accepted-response manifest removal
and durable quarantine rules are preserved. An uncertain HTTP outcome can be
resent by the existing duplicate-safe upload path; counters are not delivery
proof for a timed-out process.

Author validation: **76 related Vitest cases**, **15 isolated Node cases** and
**6 Python derivation checks** passed; targeted strict TypeScript and ESLint
passed. Existing quarantine fault-injection tests now distinguish the added
cursor fsync phase using held file descriptors, preserving their quarantine
assertions. Root independently checked frozen source hashes and the focused
changes. Actual queued delivery, outage and host cold boot remain untested.

The operational Python guard candidate additionally bounds its Docker client
wait at 75 seconds. That candidate is not installed. The live guard deliberately
continues to require the old exact relay and manifest hashes; changing the relay
alone would refuse. Deployment requires a consistent derived bundle, private
runtime packet and matching guard with a retained rollback, followed by metadata
and scheduled-pass verification. No existing installer should be blindly replayed.

Independent GPT-6.1 Sol high review accepted exact maintained relay SHA
`11e01313548c60678b3be797d96b371b8f5d3bfe536ce26a390b0d5f0d669697`
with no P0–P2 findings after the queue-boundary fix. This is source acceptance.

### Upload-only receiver factory — PG16 qualified, 25 October 05:28 Bangkok

The exact accepted receiver factory `129c1910…` passed against PostgreSQL
16.13 and the deployed application image in two owned disposable containers.
The factory verified its restricted TLS identity before listening, accepted an
authorized synthetic upload, preserved file identity on replay, rejected changed
bytes and unauthorized owners, exposed only its intended routes, and closed
cleanly. Database readback confirmed ready storage and one queued job. All
21 existing permission denials and TLS negatives remained effective.

The root-dispatched packet was `48a72f05…`; receipt
`PBX-PG16-UPLOAD-RECEIVER-FACTORY-20261025-v1.json` reports exit 0, both clones
removed, stable archive custody and unchanged protected production processes.
No production login, grant, upload route or storage volume changed. This proves
the factory with the qualification fixture identity; production UID 1001 and
its actual bind-mounted storage still need their own deployment admission.

The bounded voicemail release has also been built from committed source
`b40e8022…`. Its actual bundle `c0e8f168…`, derived manifest and matching guard
passed independent source review. Fifteen isolated generated-bundle cases and
five protocol-derivation cases passed. These artifacts are not yet installed;
the live scheduled worker remains on its previous coherent release.

### Additive voicemail release custody — 25 October 05:46 Bangkok

A live read-only check confirmed the new bounded relay can be added under the
existing directory mount without replacing the old relay's separately bound
inode. The exact eight mounts, old relay bytes, current guard and private packet
remained unchanged. The new filename was absent in both host and native views.
The existing host/native lock was the same inode; the observation did not acquire
it or claim an installation fence.

Receipt `PBX-VOICEMAIL-ADDITIVE-RELAY-CUSTODY-20261025-v1.json` reports exit 0
and cleanup confirmed. Packet `3245d9be…` passed independent source review and
seven focused tests. Installation still requires timer scheduling control and
the actual lock, followed by coherent new relay/guard/packet selection. The old
relay and its mounts will remain available for rollback. No queue entries or
audio were read, and no service or storage changes occurred in this check.

### Restricted upload receiver staged — 25 October 05:47 Bangkok

The reviewed stopped-stage packet completed successfully on production. New role
`phone11_upload_runtime_20261025_v1` (OID 26458) is NOLOGIN with the exact
ten-table column grants and no sequence permissions. Candidate container
`b3b037cb…` is created but stopped, with UID 1001, read-only root, all capabilities
dropped, restricted resources and loopback port 3031 mapped to container 3000.
The existing recordings bind was preserved; no recording data was read or written.

Receipt `PBX-UPLOAD-RECEIVER-STOPPED-STAGE-20261025-v1.json` reports exit 0,
confirmed role/container outcomes, cleanup and unchanged protected processes.
Root verified all 20 source pins; independent GPT-6.1 Sol high review accepted
packet `a3815dc5…`. Author checks passed 10 focused cases and nine isolated PG17
constructor/readback cases. The earlier exact-image PG16 factory proof remains
separate from this stage.

No LOGIN, HBA, startup, public upload route or old backend changes occurred. The
next activation must prove restricted TLS access, actual UID 1001 storage access
and listener lifecycle before switching ingress. This does not remove the old
legacy service's elevated role or prove actual recording delivery.

### Upload TLS restrictions and bounded relay installed — 25 October 05:59 Bangkok

The upload receiver's nine role-specific HBA rules were installed and PostgreSQL
reloaded without restart. They allow TLS/SCRAM from 172.18.0.31 to phone11ai only,
reject plaintext and other origins, and preserve every prior HBA byte. All 44
parsed rules matched. The role remains NOLOGIN and its container stopped pending
the next activation. Receipt `PBX-UPLOAD-RECEIVER-SCOPED-HBA-20261025-v1.json`
reports exit 0, no unknown effect and cleanup confirmed.

The bounded voicemail relay is now installed at the new sibling path
`/opt/phone11ai/voicemail/relay-bounded-20261025.mjs`. Its matching guard, private
runtime packet and new 95 drop-in were installed under timer scheduling control
and the exact existing native lock. The lock was released before the timer was
restored. Old relay bytes, mounts, guard and 90 drop-in remain for rollback; no
FreeSWITCH/backend restart or worker force-stop occurred. The install packet
`0956f545…` passed independent review after fixing a released-lock rollback path.
Fifteen focused installer cases passed before dispatch.

The subsequent read-only observation confirmed **four completed scheduled passes,
zero refusals, an active/enabled timer and an inactive successful service**. Counts
were delivered 0, retry 0, quarantined 0; this is not actual mailbox-delivery proof.
Both installation and observation report cleanup confirmed and unchanged
protected runtime identities. No call, queue/audio inspection or host reboot was
performed. The 60-second trial remains; Android and phone testing remain deferred.

Receipts: `PBX-VOICEMAIL-ADDITIVE-RELAY-INSTALL-20261025-v1.json` and
`PBX-VOICEMAIL-ADDITIVE-RELAY-SCHEDULED-20261025-v1.json`. New guard SHA256 is
`6414ae0c2f88a7b59ed85f63147d964bbe0e712e4c73841f4ee7812285748a51`.
The old elevated legacy role still requires retained-route and worker migration.

### Restricted upload receiver activated — 25 October 06:05 Bangkok

The staged upload receiver is running on loopback 3031 under UID 1001. Its exact
restricted role now permits LOGIN through the scoped TLS/SCRAM rules. Live checks
proved its identity and denied incorrect credentials, plaintext and an untrusted
CA. Its mounted recording directory passed an exclusive harmless temporary-file
write/read/hash/removal check. No recording or customer row was created or read.

Receipt `PBX-UPLOAD-RECEIVER-ACTIVATION-20261025-v1.json` reports exit 0,
cleanup confirmed, unchanged protected processes and no unknown mutation outcome.
Missing/wrong HTTP secrets returned 403; invalid input with the correct secret
returned 400 before SQL; excluded routes returned 404. Root verified 14 exact
source pins and independent review accepted packet `ce73be23…`; author checks
passed 11 focused cases and four isolated PG17 LOGIN cases.

Restart policy is still `no`, and public upload ingress still selects the old
backend. Policy promotion and route transition follow separately. This activation
does not retire the old elevated database role or establish real recording
arrival, in-flight upload drain or host cold-boot recovery.

### Upload restart policy promoted — 25 October 06:10 Bangkok

The upload receiver now has Docker restart policy `always`. The reviewed action
changed only that policy on the exact qualified container; init/Node identities,
full runtime configuration, private artifacts, HBA and other services remained
unchanged. No restart was triggered. Health/invalid-request checks passed and the
observed pool had one TLS session from the expected .31 address to phone11ai.

Receipt `PBX-UPLOAD-RECEIVER-RESTART-PROMOTION-20261025-v1.json` reports exit 0,
cleanup confirmed and no unknown outcome. Its native result SHA256 is
`53282f262981db31546135d89e3c33496e968723ada1caad7db9f1fe06cd234a`.
Root verified eight source pins; independent review accepted `d49a8f8a…`, with
seven focused author checks passed. Public ingress and actual cold-boot recovery
remain separate; the old elevated legacy login has not been changed.

### Restricted upload ingress live — 25 October 06:20 Bangkok

The exact public `/api/recordings/upload` location now selects the qualified
receiver on loopback 3031. Nginx loaded a new worker generation without restart;
normal verified HTTPS returned 403 for missing/wrong secrets and 400 for the
fixed invalid request before SQL or storage. Target attribution combines the
exact route, observed loaded generation and current qualified receiver; the 400
response alone would not distinguish the old handler. All other original site
bytes, the symlink and voicemail 3026 route were preserved. The original inode
is retained privately for the reviewed explicit rollback.

The first attempt refused before mutation because the original default proxy
block had `proxy_cache_bypass $http_upgrade`. A read-only fixed-config diagnostic
confirmed this exact single directive. The corrected renderer accepts only that
plain one-argument form, preserving its bytes; unrelated directives, arguments,
blocks, quoting or duplicates remain rejected. No access control was bypassed.

Receipt `PBX-UPLOAD-ONLY-NGINX-TRANSITION-20261025-v2.json` reports exit 0,
cleanup confirmed and no unknown effect. Active site SHA256 is
`b096ce2073df072db936abec687ac8f179df5cd00fd1e3742af0cf19ee5f7ade`.
Root verified 12 source pins; independent review accepted packet `861dd139…`.
Six renderer and nine lifecycle/HTTPS checks passed before dispatch.

No valid recording, customer row/audio access, old backend stop or host reboot
occurred. The 60-second trial remains; Android and physical phones are deferred.
CDR and upload now have separate restricted receivers, but legacy aliases and
the old backend's elevated login remain pending retained-route/worker migration.
Real recording delivery, interrupted delivery replay and cold-boot acceptance
are not established by these malformed-request checks.


### Restricted legacy connection and CDR retry transport — source integration

The maintained PBX database module now supports an explicit owned connection
binding before its first pool access. It fixes the actual JavaScript driver,
verified CA/hostname TLS, discrete target, deadlines and search path. The actual
auth adapter and route code share that module graph's pool. Its closer captures
that pool once and prevents reopening after closure or a failed close. Existing
unconfigured processes retain their previous behavior; this is not a live
credential or privilege change. Independent review accepted database source
`b7eaa835…`; 31 focused pool tests plus four runtime tests passed, including a
rerun after restoring the repository's pinned package manager/dependencies.
Strict standalone TypeScript passed. Targeted ESLint found only the unchanged
legacy dynamic environment lookup at `server/pbx/db.ts:91`; it did not pass cleanly.

The maintained call-record replay directory now includes the reviewed fixed
loopback HTTP transport (`8a67176e…`). It sends the worker's exact encoded request
once, with bounded response parsing and a total I/O deadline. Unknown outcomes
remain blocked from automatic retry; original files and durable snapshots stay
intact. Ten owned-loopback integration cases passed. Independent source review
accepted it; no production replay or service activation occurred.

A live replay driver still needs private credential/runtime binding, current
route and tenant admission, and independent producer-completion evidence. The
transport does not provide those by itself. The remaining legacy authenticated
route/worker migration and real cold-boot/delivery acceptance remain open. Keep
the 60-second trial; Android and phone testing remain deferred.


The current recovery handoff is
[DELIVERY-RESTART-GAPS-v2.md](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/reboot-recovery-oct25-v1/DELIVERY-RESTART-GAPS-v2.md).
It supersedes the earlier unbounded-relay description and records the installed
bounded relay, dedicated receivers, preserved rollback state and remaining
outage/cold-boot acceptance. Earlier v1 notes and receipts remain historical.


### Bound retained HTTP library — reviewed source, not deployed

`scripts/phone11-retained-runtime/` now reproduces the reviewed narrow backend
library from 35 pinned maintained inputs. Authentication, wake handlers, chat
media and recording playback use the same strict pool. Storage imports are
loaded after explicit private configuration; setup and closure are terminal.
Production-only HTTPS validation closes the development-loopback configuration
gap found during review. Full API/background startup remains excluded.

Ten focused library cases passed. Root verified all 35 inputs; independent review
accepted the frozen operational artifact `82ddacbb…` and its maintained source
integration. The repository-relative build emits only ignored local artifacts;
it does not listen, start workers, read credentials or change production.
Actual route SQL/permissions, storage authority, provider drain and the old
backend migration are still separate. Source wiring is not a grant to retire
the elevated legacy login.


### Retained auth/playback rehearsal — input boundary corrected before retry

The first exact PostgreSQL16/image rehearsal restored its disposable archive,
applied clone-only prerequisites and prepared the restricted fixture role. It
then refused before starting the application probe: the private JSON input was
305,189 bytes, above the unchanged helper limit of 262,144 bytes. The artifact
base64 alone exceeded that limit. Local PostgreSQL17 checks had used a different
process launcher and therefore did not exercise this envelope; source review
also missed it. This was not a PostgreSQL16 permission failure or a successful
auth/playback qualification.

Receipt `PBX-RETAINED-AUTH-PLAYBACK-PG16-20261025-v1.json` records exit70 and
`ACTUAL_BOUND_AUTH_PLAYBACK`. Both disposable containers were removed, archive
custody and protected process identities were unchanged, and no production SQL
writes occurred. The correction stages only the exact hash-pinned artifact in
the owned disposable application container; input/output limits remain intact.
A helper-level regression and independent review precede any corrected run.


### Actual restricted auth/playback passes PostgreSQL16 — 25 October 06:54 Bangkok

The corrected exact-image rehearsal passed with the unchanged bound candidate
`82ddacbb…` and original helper limits. Eleven focused author checks included
actual helper transfer/cap and exclusive-file/symlink regressions; the corrected
owned PostgreSQL17 check passed before independent source acceptance. Root
verified all16 source pins and ran the accepted PostgreSQL16 packet once.

The real installed auth cookie helpers and maintained HTTP handlers established
session refresh, expiry cleanup, disabled-identity rejection and durable signout.
Owned synthetic recording GET/HEAD/range bytes matched; cross-user, cross-tenant,
unassigned and expired access was denied. Exact effective column permissions
passed with16 forbidden operations denied, including business writes, schema and
role changes. The maintained HTTP shutdown closed its actual owned pool.

Receipt `PBX-RETAINED-AUTH-PLAYBACK-PG16-20261025-v2.json` reports exit0 and
`PG16_RETAINED_AUTH_PLAYBACK_PROVEN_OTHER_RETAINED_ROUTES_UNQUALIFIED`.
Native result SHA256:
`31909ff3c5377c9463a6856da02114716f5a194baacd3271f1adcb5a7f7a2850`.
Both disposable containers were removed; archive custody and protected process
identities remained stable. Independent receipt review accepted the scoped
result. No production SQL, customer recording or provider request was made.

This uses precreated synthetic sessions, not credential sign-in. A separate
client checked TLS/settings before listening; the actual pool's identity/TLS
was observed after readiness. Actual-pool prelisten settings attestation, other
retained routes and full provider/resource drain remain unqualified. The old
production credential and grants were not changed.

The concrete remaining consumer map is
[NEXT-LEGACY-CUTOVER-v1.md](/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/pbx/legacy-session-attribution-oct25-v1/NEXT-LEGACY-CUTOVER-v1.md).
Moving auth/playback alone would remove no effective privilege from the old
backend while its remaining handlers and workers retain the same credential.
The next useful slice is actual chat-media SQL/file behavior, followed by wake
and callback disposition and a controlled old-worker replacement.
