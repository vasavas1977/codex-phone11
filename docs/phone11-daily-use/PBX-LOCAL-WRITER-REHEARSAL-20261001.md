# Phone11 PBX local writer/role rehearsal — 1 October 2026

**Synthetic local rehearsal completed: 31 checks passed and five boundaries
were observed. Production admission remains blocked.** This adds restricted
LOGIN, ordered migration and read-only preflight evidence. It is not a
protected restore of the live database or acceptance of its retained writers.
No existing migration, preflight, application or production configuration was
changed.

## Target, source and isolation

The migration/preflight source basis is
`9c0f9827b001dce0c76a261ceb5dcea6855258df`, with one new local harness:
[`scripts/phone11-pbx-local-writer-rehearsal.ts`](../../scripts/phone11-pbx-local-writer-rehearsal.ts).
Its source hashes are pinned below. The harness consumed only the existing
[read-only audit](PBX-WRITER-AUDIT-FOLLOWUP-20261001.md)'s extension column
metadata, whose SHA-256 is
`492751ebf657789a98261f60b1c4b1d69d0b4c23b9606bf4cc81bcc28c66b7d3`.
It copied no live customer row, password, environment or credential.

The completed run ended at **2026-10-01 16:12:50 UTC** on a newly created
Docker PostgreSQL **16.15**, ARM64 image
`sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`.
The live audit reported **16.13**; this patch-version difference is a limit.
The synthetic database was `phone11_pbx_test` at host-loopback port **64872**,
container `phone11-pbx-local-e30583c1d90f83e8`, container ID
`5ad17d60779c9be2b9facd02739d9ea27af8e13d3a6cdf4d313a12b65acdfa0b`,
on its separate bridge `phone11-pbx-local-e30583c1d90f83e8-net`.

The database used a 256 MiB tmpfs, with no persistent data volume; the harness
verified both Docker's tmpfs configuration and the actual mounted filesystem.
It checked the exact container ID/image/owned label, running state, sole
network, bridge ownership and `127.0.0.1` port binding before connecting.
The client also pinned the database and both current/session login identities.
Generated local-only credentials lived in mode-0600 files and process memory;
no credential value or credential hash was emitted. The final container,
network and local credential files were removed, and their absence was
verified. The same cleanup was verified for every earlier owned attempt.

An initial internal Docker network refused published host connections. The
completed run used a separate ordinary bridge and a host-loopback-only
binding; it did not share an application network. The readiness check used
TCP, avoiding the official image's temporary Unix-socket-only initialization
server. This difference from a network-internal clone is recorded rather than
counted as production protection evidence.

## Synthetic schema and actual logins

The extension fixture reproduced all 19 column names, types, nullability and
default expressions from the audited catalog, with the observed integer PK,
nullable `tenant_id DEFAULT 1` and absent tenant FK. It used four newly
invented extension rows and two synthetic tenants. The other phone-config
preflight tables used source-defined minimum columns/types. This intentionally
provided a second synthetic tenant; production has no admitted second-active-
tenant fixture for the approved pilot users.

The seven live noninternal extension triggers, actual owners/ACLs, external
writers, packaged application processes and customer data were **not**
restored. The fixture's access profile is a proposed test profile, not the
live shared-superuser profile.

The operator created three distinct password-authenticated TCP LOGIN roles:
`p11_local_writer`, `p11_local_reader` and `p11_local_outsider`. Each remained
NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB, NOREPLICATION and NOINHERIT,
with no granted role membership. `session_user = current_user` was verified
for each genuine login; superuser `SET ROLE` was not substituted for them.
An incorrect writer password was rejected with `28P01`, confirming actual
SCRAM authentication.

The writer had schema USAGE, SELECT on synthetic tables, extension DML and
sequence USAGE/SELECT; after migration it also received DML on the nine
synthetic routing tables. It owned no table, function or schema. The reader
had schema USAGE and table SELECT only. The outsider had database CONNECT
only. These grants are local rehearsal inputs; no equivalent production role
change is proposed as already safe for the retained artifacts.

## Completed checks

All 31 recorded checks passed in the final run; the five observations below
are separately labeled and are not counted as negative tests passing.

| Behavior exercised through actual logins | Result |
| --- | --- |
| Missing/mismatched database pin, missing schema pin or absent legacy-removal acknowledgement | `55000`; legacy catalog unchanged |
| Legacy SQL on its own fresh idle connection | Default removed, NOT NULL and validated same-schema FK installed |
| Exact legacy replay | FK OID and xmin unchanged |
| Restricted writer omits tenant after prerequisite | `23502` |
| Restricted writer supplies orphan tenant | `23503` |
| Restricted writer supplies explicit valid tenant | Insert succeeds; test write rolled back |
| Advanced SQL missing schema pin | `55000`; routing DDL absent |
| Legacy followed by advanced SQL on separate fresh operator connections | All nine routing tables installed |
| Restricted writer calls the repository's read-only preflight | `compatible`, no base/phone-config/advanced issues |
| Otherwise permitted writer INSERT in READ ONLY transaction | `25006` |
| Cross-tenant ring-group/queue membership | `23514` |
| Same-tenant membership | Succeeds |
| Reassign referenced extension or ring-group tenant | `23514` |
| Reader INSERT, outsider SELECT, writer tenant INSERT | `42501` |
| Writer CREATE ROLE, grant its role to outsider or SET ROLE operator | `42501` |
| Writer disables triggers, restores DEFAULT 1 or sets replica trigger mode | `42501` |
| Advanced replay and final role/membership readback | Compatible writer preflight; all restrictions unchanged |

## Five observed boundaries

1. Before the prerequisite, an omitted-tenant INSERT really acquired tenant 1
   through the legacy default. That reproduces the default-removal compatibility
   question; it does not identify every live writer relying on it.
2. Raw advanced SQL executed in a separate disposable `pbx_unsafe_order`
   schema accepted ordinary base tables with nullable `tenant_id DEFAULT 1`
   and no tenant FK. This is a **standalone admission boundary**, not a
   demonstrated defect in the supported ordered path. The SQL's target guard
   pins database/schema/ordinary relations
   ([lines 35–53](../../server/pbx/advanced-routing-migration.sql#L35)); it does
   not prove the separate prerequisite, writer or rollback review. The
   documented operator contract explicitly orders legacy then advanced as
   distinct transactions and requires external ownership/clone/operator gates
   ([release gates, lines 21–25](PBX-RELEASE-GATES-20261001.md#L21)). A bounded
   search of `scripts`, `server`, `ops` and `.github` found no production
   auto-runner referencing these SQL files; hosted/manual/dynamic operator
   paths remain outside that absence claim. The initial expectation that raw
   advanced SQL itself would reject this legacy shape **failed**; that raw
   failed run is retained and is not counted as a pass. The independent probe
   schema was dropped before the correctly ordered main rehearsal continued.
3. The SELECT-only reader saw all routing columns but no routing primary keys
   through `information_schema.table_constraints` and
   `information_schema.key_column_usage`
   ([preflight lines 419–429](../../scripts/phone11-pbx-schema-preflight.ts#L419)).
   Its preflight therefore failed closed as `incompatible` with nine
   `:primary_key` issues. The initial expectation of compatible SELECT-only
   preflight also failed and is not counted as a pass. Compatible preflight
   was actually obtained through the restricted writer, inside the unchanged
   read-only preflight transaction. Future read-only operator-role design must
   account for catalog visibility; this rehearsal did not grant extra DML to
   the reader or weaken preflight checks.
4. A table-granted writer can directly create an extension in either valid
   synthetic tenant. Foreign keys and membership guards do not establish
   per-actor authorization, and the migration introduces no RLS actor policy.
   The real handlers' authenticated tenant context remains a separate gate.
5. An unreferenced extension can change to another valid tenant. The advanced
   guard protects existing group/queue membership during moves; it does not
   establish permission for a caller to perform an otherwise valid move.

These observations explain the boundaries of the successful tests; none is a
claim that production roles, API tenant checks or rollback artifacts are safe.

## Commands, retained evidence and next gate

The private operator wrapper used the already installed Docker, Python and
repository `tsx`; no shared dependency was installed. Its concrete command
sequence, owned resource IDs and cleanup results are retained in the operator
record. It created a new labeled bridge, started the pinned image with only
`127.0.0.1:64872:5432`, tmpfs storage and a protected local environment file,
then invoked:

```sh
cd /Users/vasavas16macbookpro/Documents/Codex/phone11-zoom-mainline-integration-20260928
PHONE11_PBX_LOCAL_REHEARSAL_CONFIG='<generated protected local config path>' ./node_modules/.bin/tsx scripts/phone11-pbx-local-writer-rehearsal.ts
./node_modules/.bin/eslint scripts/phone11-pbx-local-writer-rehearsal.ts
./node_modules/.bin/tsc --noEmit --pretty false
git diff --check
```

The generated config has been removed; this placeholder is an explanation,
not a ready-to-run production command. The actual local launcher was
`python3 /Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-pbx-local-writer-rehearsal-20261001/run-local.py`.
ESLint exited zero with the repository's existing module-type warning;
TypeScript and diff checks exited zero. No unrelated suite was rerun.

Private evidence is under
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-pbx-local-writer-rehearsal-20261001/`:

| Evidence | SHA-256 |
| --- | --- |
| `result-e30583c1d90f83e8.json` — 31 passes, five observations, catalogs and role readback | `e77439181ca5d5a80be86cebfd51f5e6827bc58e6765e8aec1f1c3b1158fe957` |
| `operator-record-e30583c1d90f83e8.json` — exact commands, resource IDs and cleanup | `6ef5ac263b681c85d39967d289397f051733bdb15eb8d2306110e2fad1150899` |
| `evidence-seal.json` — source/evidence hashes and cleanup/redaction assertions | `f37e9c1e0d95692612d342636db3f40e52c85e59fcaf41f0dab71162790e0a89` |

Earlier metadata-guard/transport failures and the two failed expectations are
retained in separate `run-output-*` and `operator-record-*` files. They are
excluded from the final 31-pass result. The final seal verified all owned
containers/networks absent, all local credential files removed, result counts,
role flags, source hashes and absence of credential fields in the result and
operator record.

| Source executed | SHA-256 |
| --- | --- |
| Legacy-default prerequisite SQL | `2deb0b79fa7d00aea093ba7c00099a99f8df7a756700c001579c94439207bed8` |
| Advanced-routing SQL | `e5675dfe34bfdd2ce76a12dc1c6b4d848edd36e34908962deb39c0d8f470ee96` |
| Existing PBX preflight | `76738137a3794f0084ce7c0863a2c4218b3aa078085859f8f74c71472635fab6` |
| New local writer/role harness | `9ffa808a8739250d5b2a0968a0f5b9f0ba463e95bc47bd4f8b08f213cfebffcd` |

The next actual-target gate still requires accountable ownership of all 22
credential-bearing containers, the active host service, manual/IAM/SSM and
external credential holders; an approved recreatable active/rollback set;
a protected fresh target restore with its real trigger/access profile; and
independent operator review. Rehearse the actual admin/provisioning handlers,
legacy initializer, each retained rollback artifact and their intended login
permissions there. Verify restore and application rollback on that admitted
clone. This local fixture did not run those applications or restore backups,
and it proves no migration/data rollback.

The local result reports `productionAdmission.admitted = false` and names
those missing gates. SQL acknowledgement is not evidence of rollback review.
No production DDL, role/credential change, service/route activation, provider
change or physical-device acceptance occurred.
