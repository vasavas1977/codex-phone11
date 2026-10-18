# Outbound policy: local rehearsal and future release

Owner: Phone11 owner. Updated 18 October 2026, Bangkok. A separate source-bound
five-file generated qualification completed **67/67** tests on PostgreSQL
**16.13**, including storage, actual API/dynamic-dialplan handlers and authenticated
HTTP requests. The preceding PG17 run completed **55/55** tests. The earlier fixture save and
43-test three-file run remain historical evidence. No production migration,
deployment, routing activation or live commissioning has executed under this
runbook. This applies only to the existing two international/premium controls. It does not
commission trunks, queues, IVR, spending enforcement, Android or phone tests.

## What is prepared

- `components/admin/outbound-call-policy.tsx` is the real product form.
- `dev/fixtures/outbound-policy/` imports that component unchanged and supplies
  generated auth/workspaces and in-memory transport. It cannot prove API, DB or
  production acceptance. Its README has the finite user steps.
- `fraud-controls-migration.sql`, `audit-storage-migration.sql` and
  `audit-runtime-permissions.sql` are separately reviewed source contracts, not
  application-startup migrations. Read each file's exact session/identity pins.
- `scripts/phone11-local-policy-rehearsal.py` defaults to a plan, not a launch.
  Its explicit run requires an externally pinned source/tool manifest. The final
  approval packet supplies the exact manifest path and SHA, not an unbound
  placeholder. Native tests use generated schemas/roles only.

All saved branches and uncommitted files must be preserved. Do not delete old
clusters, replay uncertain operations, promote clone-only audit SQL, or replace
an existing dependency directory.

## Current local qualification

The initial version-matching PG16 receipt is
`/private/tmp/p11-policy-pg16-siwh3wsn/receipt.json`, SHA256
`99e7c9b4c9d5c35da535f6202902415ab16f7232501d15d5d968aba8ddef2aab`.
All **67 passed**, zero failed/pending: 8 permissions, 17 audit, 18 fraud migration,
12 actual handler and 12 authenticated HTTP cases. The manifest
`work/phone11-publish-pbx-20261014/review/pg16-policy-qualification-20261017-v1/QUALIFICATION-MANIFEST.json`
under the operator workspace has SHA256
`30c99b930b2e1d6a6f1d0da853c4519b6a6af29ea44cabaf6af8e2d8c25527af`.
It binds 31 source, 11 tool/library and 16 selected dependency pins. Source,
tools and dependencies stayed stable; the owned cluster exited 0 and the
temporary dependency link was removed. An independent review verified the
receipt and artifact hashes. This is generated macOS/C-locale PG16 evidence,
not deployed Linux/TLS/ICU, backup recovery or active routing acceptance.

After adding the real `@types/react-dom` dependency, rebinding both rehearsal
launchers to a new private dependency tree, and fixing exact-host TLS identity
verification, a fresh PG16 run passed **67/67** tests. Its receipt is
`/private/tmp/p11-policy-pg16-7jzxgtnt/receipt.json`, SHA256
`a19cda59b444b1cff5d6cd4fffd04aec4746b71e5d8df9d10eb695a0491e4f50`.
The new `PG16-QUALIFICATION-MANIFEST-v2.json` in the operator commissioning batch
has SHA256 `c78323c2e31a1574004a76e617c8e57b3cfd8bae00ceb81b42beb5a621c41366`.
Independent review matched all 58 pins, 67 passing tests, stable inputs, stopped
owned cluster and removed temporary link. Historical manifests were not edited.

After adding the protected-only UNBOUND handler and pinning its imported core,
a new run again passed **67/67** checks. Its receipt is
`/private/tmp/p11-policy-pg16-w87054uh/receipt.json`, SHA256
`85ae03a0cee9eb7e22d90d168c85a3dd47a0a6e118dd91c7896d5e19aee272aa`.
The current `PG16-QUALIFICATION-MANIFEST-v4.json` has SHA256
`89265a43e173c319e66decf823231bfa5443dbe80f2823fe8481ee00999af13c`,
binding 32 source, 11 tool/library and 16 dependency files. Source, tools and
dependencies stayed stable; the owned cluster stopped with exit 0 and its
temporary link was removed. Independent result review matched all 59 pins,
four artifact hashes and every declared test. Manifest v3 was held but never executed; it is not
runtime evidence. Live TLS, restricted production permissions, real relay and
carrier routing remain separate gates.

The preceding PG17 finite evidence is
`/private/tmp/p11-policy-v8ze2xah/receipt.json` and
`/private/tmp/p11-policy-v8ze2xah/vitest-result.json`: **55 passed, zero failed or
pending**, comprising 8 runtime-permission, 17 audit-storage, 18 fraud-migration
and 12 actual API / dynamic-dialplan-handler tests. The receipt records generated
data only, no production access, stable source, successful test/cluster exit and
a stopped owned PostgreSQL child. Generated data is retained.

The final **20-source-pin** manifest is
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/review/pbx-api-integration-20261017-v1/NATIVE-API-MANIFEST-v4.json`,
SHA256 `cd921b76bb78ff0ca4c791a99dbe00e9f99eea55b437399604e867704935e79f`.
Its digest and source pins match that historical receipt. The adapter later
received the exact-host TLS fix covered by the new PG16 run above. The launcher now has
a separate HTTP-authentication scope; the historical manifest is not a launch
authorization for that changed source. Use a new exact manifest for new work.

Separately, the current private dependency candidate passes full strict
TypeScript, backend build and **151 affected adapter/API/FreeSWITCH tests**.
It installs the existing locked desktop type dependencies without Electron
binary download or install scripts. The earlier 503 focused checks remain
historical. Generated restricted-role behavior on PG17 and PG16
is local evidence only: deployed production PG16, the intended live restricted LOGIN, serving-route enforcement and live
commissioning remain unqualified.

The new, separate generated HTTP scope passed **12/12** real credential-sign-in,
cookie/session, tenant-admission, policy read/save/readback and rejection/rollback
cases. Its finite receipt is `/private/tmp/p11-policy-0mw59u3l/receipt.json` with
`vitest-result.json`. The reviewed `HTTP-AUTH-MANIFEST.json` in the same operator
packet has SHA256
`65bd05101ee8f115b03d9cfae1ce6ee405e3bc378fb7f3b8b4e94fdf5d844d75`
and binds 31 source, six tool and 16 selected dependency entries. Source stayed
stable, owned test/cluster exited 0 and the temporary link was removed. One
test-owned ephemeral loopback HTTP listener served generated accounts only;
no email, provider or production service was contacted. This still does not
qualify browser HTTPS/cookie enforcement, the deployed production database or routing.

## Decision A: isolated interactive fixture

After a specific launch approval, from this checkout:

```sh
/Users/vasavas16macbookpro/.local/bin/node --max-old-space-size=256 dev/fixtures/outbound-policy/serve.mjs
```

Open `http://127.0.0.1:8106/` in a fresh browser context without loopback cookies.
This runs one local esbuild pass into RAM and one fixed loopback listener. No
Metro, installation, external assets or production account is involved. The
bundle and model are not written to disk. Expected but unmeasured footprint:
100–350 MiB transient build helper, 30–100 MiB Node, 100–300 MiB browser. These
are estimates, not a total-RSS limit. Only the real card is product code; harness
buttons are clearly generated test scenarios. Cookie-bearing/cross-origin
requests and unknown asset/API paths refuse. If the component/import-graph pin
or port check refuses, preserve output and stop; do not loosen the guard.

Success means the user can toggle, save, read back, switch generated workspace,
and exercise failure/stale-result cases on the real controls. Stop with Ctrl-C;
the listener also closes after 30 minutes. No existing data needs cleanup.

## Decision B: generated native database rehearsal

The final review packet supplies an exact command for
`scripts/phone11-local-policy-rehearsal.py --run-isolated-generated-only` plus
`--manifest` and `--manifest-sha256`. Do not run an unpinned command. Its default
plan invocation starts nothing:

```sh
python3 scripts/phone11-local-policy-rehearsal.py
```

The storage/handler run creates a new private `/tmp/p11-policy-*` directory; initializes
a generated PostgreSQL cluster; binds only `127.0.0.1:55436` and a private Unix
socket; creates only `phone11_pbx_test`; then runs four fixed native test files
with one Vitest worker. No app environment or production service definition is
loaded. TCP uses a generated SCRAM password retained only in that private
directory and child environment. It is never printed or passed as an argv value.
Private Unix-socket trust is for this generated cluster, not auth acceptance.

It caps PostgreSQL at eight connections and 16 MiB shared buffers. Unmeasured
total estimate: 200–650 MiB for PostgreSQL plus Node, 80–160 MiB retained disk,
15–120 seconds. It stops only its newly created cluster and removes only the
temporary dependency link it created. Cluster data, private logs and receipt are
retained. On an uncertain stop, preserve the exact path/PID and investigate;
never kill/delete an unrelated cluster or blindly retry.

The distinct `--run-isolated-generated-http-only` flag selects only the HTTP
suite and requires a manifest with `qualificationScope=generated-http-auth-only`
and its additional authentication/middleware/dependency pins. It creates the
same generated database plus one owned ephemeral `127.0.0.1` HTTP listener.
Vitest uses threads inside the owned Node process so its timeout cannot leave a
forked listener behind. Default invocation still only prints a plan. Never run
both scopes or the interactive fixture concurrently, reuse a historical manifest
after source changes, or present a stopped/expired fixture URL as live.

The original installed tools are PostgreSQL **17.11**; a private source-pinned
PostgreSQL **16.13** toolchain now matches the observed production version.
The separate `scripts/phone11-pg16-policy-qualification.py` ran all five suites
with generated data only. Both launchers default to a plan and require exact
manifests for execution. These results do not replace the intended live
runtime-role login and authenticated HTTP/API test. The same limit
applies to fake transport tests and source review.

## Future production prerequisites — not execution authority

The target remains the existing owner-selected Phone11 EC2 at 43.210.122.111.
Before a production decision, bind current instance/container/image, PostgreSQL
system identifier/database OID/schema and live serving-source identity afresh.
The earlier catalog found `fraud_controls` and `audit_logs` absent. Do not assume
that observation is still current or run an old whole-PBX migration against it.

The shared `db.ts` pool remains unchanged for unrelated operations. Fraud GET
and its two-flag update now use `fraud-policy-db.ts`, with a separate fixed-tenant
LOGIN, per-lease identity/helper/storage attestation, safe local search path,
actor-helper locks and same-client strict audit. A missing or mismatched binding
refuses; no privileged fallback is provided. See `FRAUD-POLICY-API-INTEGRATION.md`
for the explicit operator configuration contract. A writable session GUC is not
an identity boundary. Runtime login and real authenticated HTTP/API read-save-
readback still need deployment-specific qualification. An application-supplied
actor ID is trusted backend context, not database authentication of the end user.
Freeze operator schema/helper/grant DDL while commissioning and serving this
binding; per-lease catalog attestation does not lock all catalog definitions
against a concurrently privileged operator changing them.

### Fresh recoverable backup

Observed on 17 October 2026: a new protected capture on the encrypted Phone11
root volume contains the database archive and original role verifiers. Its
shared exported snapshot covers 67 tables and 495 aggregate rows. The capture
is sealed; credentials and customer contents were not exported. This is still
same-volume custody, not off-volume disaster recovery.

A fresh isolated restore completed on 17 October 2026. All eight catalog
categories, owner/ACL/role/locale semantics, shared-snapshot row aggregates and
original role verifiers matched. The exact owned container stopped successfully.
The reviewed startup correction required the final PostgreSQL PID1 before
normalizing only its FD-held socket directory from `3775` to `0700`; the
original strict custody guard passed before SQL. The earlier failed container
was independently observed stopped and remains preserved, without adoption.

This proves the bounded database/role-verifier restore rehearsal. It does not
prove login using the original password, application credential recovery,
sequence atomicity or off-volume disaster recovery. The finite actual receipt
is `BACKUP-FRESH-RESTORE-ACTUAL-v3.json` in the operator commissioning batch.

The same day's read-only server metadata check found PostgreSQL SSL disabled.
The production policy adapter requires verified TLS. Configure and independently
qualify the exact endpoint, CA, hostname and restricted LOGIN before activation;
never set the generated-lab exception or disable peer verification in production.

A subsequent fixed-server path preflight completed 16 read-only commands and
independently confirmed stable database, process, mount and path metadata.
The expected `server.crt` and `server.key` were absent; the server CA setting was
empty. PostgreSQL's data directory was `0700`, and its configuration and HBA
files were `0600`, all owned by UID/GID 70. The probe did not open configuration,
certificate or key files, select environment/password fields, or export
credentials. Docker privately processes its full inspect response before the
reviewed metadata projection; this is not a claim that its internal response
contains no credentials. The receipt is `PG-TLS-PATH-PREFLIGHT-ACTUAL-v2.json`,
SHA256 `687d06b72db743d37fb3389a6f34f58cd3c8d18a0f4e146fce05ff2eb335f321`.
These observations do not establish key custody, effective HBA rules, a loaded
TLS context, restricted LOGIN permissions or application readiness.

An isolated Linux rehearsal using the exact cached PostgreSQL 16.13 image
subsequently passed all three TLS cases: verified TLS/SCRAM login and a read-only
query with the correct CA and hostname, rejection of the wrong CA, and rejection
of the wrong hostname. The fresh generated cluster was removed successfully.
Its receipt is `GENERATED-TLS-LAB-ACTUAL-v6.json`, SHA256
`237dc270aadb2c915b6a9598422910daf0940074b886da6129d57c263edf3bec`,
in the operator commissioning batch. This qualifies the generated native libpq
path; live server TLS, the Node adapter against that server, production LOGIN
permissions and the deployed application remain separate acceptance gates.

A later isolated run of the same cached PG16 image passed four reload phases and
nine fresh connection cases. It enabled verified TLS, retained the previous TLS
context after an invalid certificate replacement, recovered the valid settings,
and rolled back to SSL off. Wrong CA, wrong hostname and new plaintext under
strict HBA were rejected; explicit plaintext after rollback was tested separately
without automatic fallback. The original plaintext and TLS sessions retained
their backend identities and the postmaster did not restart. All generated
clients, postmaster and container closed successfully. The independently checked
receipt is `GENERATED-TLS-RELOAD-ACTUAL-v1.json`, SHA256
`1d2f330de69248cdf42706d2d3c21113add8aa60ce464b9246f3f07cf8de12f4`;
the independent result review is
`pg-tls-reload-actual-independent-review-v1/REVIEW-v1.json`, SHA256
`b31eb4d1d7c69a229c42e2acdb9eefb28c980de97a6f35d360d9efcda51d2b73`.
These are generated libpq/reload results, not a production TLS change, Node
adapter qualification, production restricted LOGIN or deployed application proof.

Prepare and review the existing protected backup-custody mechanism before any
capture. Required bindings are: current production source identity; a new
root-only 0700 backup directory; exact read-only backup principal/service;
encryption-at-rest and private credential custody; capacity/size limits; tool
and archive digests; archive listing; roles/ownership/ACL capture; and FD/file
closure. No credentials or customer rows belong in terminal output or Git.

The following are exact *command shapes*, **not runnable approvals**: the
`phone11-production-backup` service and protected run directory are deliberately
unbound until the current custody review. Do not replace them with guessed live
credentials or use the application superuser as a qualified runtime role.

```sh
pg_dump --dbname=service=phone11-production-backup --format=custom --file=/PROTECTED-REVIEWED-RUN/origin.dump
pg_dumpall --dbname=service=phone11-production-backup --roles-only --no-role-passwords --file=/PROTECTED-REVIEWED-RUN/roles-without-passwords.sql
pg_restore --list /PROTECTED-REVIEWED-RUN/origin.dump
```

Roles-without-passwords are not sufficient for login recovery: separately prove
recovery of the protected credential source, without exposing it. A dump hash,
successful listing, or old snapshot alone is not recoverability proof. Use the
matching production-major restore tools and an independently approved isolated
target; never restore into production as a test.

### Restore and forward rehearsal

On the reviewed isolated PG16 target, restore the new dump and required owners,
grants and privately custodied credentials. Preserve owner/ACL semantics; do not
silently pass `--no-owner` or `--no-acl` and then call it a faithful recovery.
Compare bounded catalog/role semantics and PDPA-safe aggregate row counts before
and after. Rehearse the forward fraud/audit contracts on a fresh idle dedicated
connection with their exact database/schema/role/version pins. The SQL owns its
transaction; wrapping it in an existing caller transaction is forbidden and is
not automatically detected by the migration. Validate rollback on incompatible
ABI, wrong target, wrong principal, revoked admin and rejected audit insertion.

Qualify the intended fixed-tenant runtime login, not `SET ROLE` under a privileged
app login as a substitute. Test other tenant denial, forged GUC denial, absent
audit UPDATE/DELETE/TRUNCATE, no direct parent membership UPDATE, correct live
admin locking, insertion defaults, and atomic policy/audit rollback. Only then
test the real authenticated API's selected-tenant GET/save/readback against the
same exact candidate source and role. No provider call is required for this
two-boolean control test.

### Exact-source package and deployment decision

The local `3d736cc…` base plus uncommitted reviewed changes are **not** PR25's
published head and are not in the retained `cdb5c41…` image archive. Before a
package decision, preserve the work; commit/review the exact intended combined
source; run strict typecheck and required CI; and bind the new frontend/backend
artifacts to that exact commit and lockfile. The completed local backend build
does not qualify a production package; no production package, upload or
publication has executed under this runbook. Source-only review is not binary
proof.

Prepare an exact guarded candidate/route/readiness/authentication plan, retained
old-route source and credential/network custody. Release schema, candidate,
route and portal actions only under their separately scoped authority after the
above evidence. A successful public health response is not a saved policy.

## Verification and rollback

After a future release, the owner can use Admin → Workspace settings → Outbound
call policy in the selected company. A new/unconfigured policy starts with
international and premium off; domestic/internal/emergency behavior stays as
before. Local Thai `1900xxxxxx` and canonical `+661900xxxxxx` both require premium
permission only and can be allowed with international off; international premium
numbers such as US `+1900` require both flags. Save one change, require fresh
matching confirmation, reload it, and
restore the original value. Exercise account/workspace retirement and revoked
access; no cross-company confirmation may appear.

If readiness or save/readback fails, stop the release and preserve receipts.
Before customer writes, a reviewed transaction refusal may roll back that
transaction. After accepted writes, reverting application traffic must preserve
those writes: do not drop populated tables or restore a stale database snapshot.
Roll back application traffic to the retained reviewed route/source and diagnose
the failed gate. Do not broaden grants, disable RLS, grant BYPASSRLS, replace a
fixed tenant with caller GUC authority, or weaken readback to make a check pass.

Escalate target drift, unexpected ACL/policy/owner, uncertain cluster stop,
credential-custody gaps or ambiguous transaction outcome to the Phone11 owner.
Report source, local generated interaction, native DB, package, live API and
provider/device evidence separately.
