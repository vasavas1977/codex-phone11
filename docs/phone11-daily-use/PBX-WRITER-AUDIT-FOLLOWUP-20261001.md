# Phone11 PBX writer and rollback audit — 1 October 2026

**The writer/rollback gate remains blocked.** A fresh authorized read-only EC2
and PostgreSQL audit pins the current artifacts and effective access, but the
single shared superuser credential and host/IAM access prevent an accountable
application-to-principal boundary. Keep live `extensions.tenant_id DEFAULT 1`
and advanced PBX commissioning blocked. No production schema, role, credential,
service, route, provider or Connect11 change was made.

## Evidence scope and freshness

Source was pinned to `7984cee0f4eed83dcad30f8bb532989b9ee3e5cc`. The complete
main catalog audit ended at **2026-10-01 15:49:34 UTC**; the final table and
fixture aggregates ended at **15:51:47 UTC**. The target was VoIP EC2
`i-0851dd1ea1cfeef71`, AZ `ap-southeast-7a`, IP `43.210.122.111`, container
`cp11-postgres`, database `phone11ai` (database OID `16384`, PostgreSQL
`160013`). Its image remains
`sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50`.

EC2 Instance Connect admitted the existing public key for the SSH session;
strict known-host verification stayed enabled. Metadata collectors ran from
SSH stdin without being installed on the host. All 22 catalog SELECTs ran in
explicit read-only transactions and rolled back; the identity read confirmed
`transaction_read_only = on`. No customer rows, environment values, credential
values, connection strings, query activity text or configuration bytes were
emitted. Credential equivalence was compared only in process memory, without
printing a password or its hash. Configuration/artifact bytes were read only
to produce metadata hashes or explicitly allowlisted access descriptors.

Private evidence is under
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-pbx-writer-audit-20261001/`:

| Evidence | SHA-256 |
| --- | --- |
| `host-db-audit.jsonl` — complete catalog/host snapshot | `492751ebf657789a98261f60b1c4b1d69d0b4c23b9606bf4cc81bcc28c66b7d3` |
| `host-followup-audit.jsonl` — artifact and service metadata through service inventory | `cf116062b2827f48c4f4d7f10f054662a4f52fdfda8a9d1e91499a8b0556c292` |
| `host-completion-audit.jsonl` — remaining targeted stages, nine-table and fixture aggregates | `03882e6779b01afeed33e1210f1ebb4874c85859b79a9d287c6a454799ca1704` |
| `evidence-seal.json` — evidence/source hashes, assertions and limits | `fd3da88a295f959ce2c93b5eff0100ac809b070fb8ffb5a49413907e9f7e5cb8` |

The initial metadata collector stopped when parsing multiline PostgreSQL JSON
output after its identity row. A corrected single-line JSONB collector
completed the main audit. The host follow-up stopped after its service
inventory because `atq` is absent; only the remaining targeted stages were
completed separately. Partial evidence is retained and is not presented as a
complete run. Local syntax, JSON parsing, evidence invariants and emitted-data
redaction assertions passed. These checks do not rehearse a migration or prove
application behavior.

## Active artifacts and rollback boundary

Both public `/api/trpc` locations still target `127.0.0.1:3016`. The regular
root-owned active site `/etc/nginx/sites-enabled/phone11ai` remains SHA-256
`aa31a27c3d65a0167fb3f8d2aca08b059f86cbec824c0777e73b278169737485`;
`nginx -T` stdout remains
`9515fab03098d66cfbf1d5531fe16f603eb07442633f7dac5382539cecd4badb`.
Dedicated auth/recovery routes still target 3004, and the fallback `/` route
still targets 3000.

| Role / runtime | Exact image (`sha256:`) | `/app/dist/index.mjs` SHA-256 |
| --- | --- | --- |
| Public 3016 / future promotion predecessor: `cp11-api-candidate-sip-consistency` | `920f21217b57750184ce546e47a6a9d93dd81787f74ff3bf76fb6faa905534c7` | `d489be90000d3cdc1c40088c6efb5048d65d44db6a3084ffebb9461ac87f682c` |
| Isolated 3021: `cp11-api-candidate-zoom-cea0ab6` | `ef120696f0f7cca1aa512b8b334edadbb8826c7cbbcf2919437d99d3530ebace` | `e588cb5a1add7fd66dbbe1906c4d23ef8059a43866559f9270bbf6ce506cfe6b` |
| Isolated 3020: `cp11-api-candidate-zoom-90d89b8` | `bf96778293b92d69e0bde9e647b239de96215269ab7b42e15f9a54ea324ddf8c` | `93b6769161196fd2e8089d08490870a6bf4de5375d94d87dab1aee0a7d2ea895` |
| Baseline/fallback 3000: `cp11-backend` | `d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619` | `57e80ecaef64f32baf6d7195ab4f63316bb6ccc802b28d1bd2595878f3bef000` |
| Dedicated recovery 3004: `cp11-password-recovery` | `21b31746db0f22295ad5d944d530b2dec4bc70400619cf9e4381bb1011c0fa54` | `4d3630a668b4fa2d0538321509cd0beefcb6956baeef3c9cf7c163aa2c48bb22` |

The 3016 container ID is
`d25edd3c93db6d464d0cb2548ea07c0af66604694648a77b7aa9ec731997e25f`;
its source label is `6180658cfcef558a7f198bcd53aa4da68e3d7cd1`. Its
root-owned 0600 Compose artifact is
`/var/lib/phone11-sip-consistency-release-20260927/compose.json`, SHA-256
`12dbe45637652dece2a1cfa56e235519807939ed08a54ead68215296a3ace0c8`.
The baseline Compose artifact is
`/opt/phone11ai/team-chat-media-20260920T000000Z/activation/candidate.json`,
SHA-256 `78d3a75f1d4998611e1a029302905ad9417283632b68e9aa967def18cc371454`.
The recovery container's Compose-label path
`/tmp/phone11-password-recovery.vg2tzw76/compose.json` is **absent**. A running
container and image pin do not establish a recreatable rollback deployment.

The 3021 source is `cea0ab6f5e6eb2f7d5d73a8cc23e915742e34a86`; its
container ID is
`c7332b08c473efd123579c2f0b92778f5ee24466b43990fea2cdd7aa2c74fae8`.
Its root-owned 0600 manifest is
`/root/phone11-mainline-cea0ab6/manifest.json`, SHA-256
`47cac7b6645e6f2c28da0c93bf98f088d95585e24a946108ef805157594fb906`;
its root-owned 0600 start receipt is
`/var/lib/phone11-mainline-release-start/c7332b08c473efd123579c2f0b92778f5ee24466b43990fea2cdd7aa2c74fae8.json`,
SHA-256 `1faf3a180b5afb62094a0ee088950428583aaf52601890b8dda7a212978af284`.
The 3020 manifest and both manifests' 3016 predecessor pins were also observed.
`/var/lib/phone11-mainline-release-route` is **absent**. There is no next-switch
sealed route/rollback receipt at that operator path. These remain retained
candidate artifacts, not an owner-approved active-and-rollback set or a
migration rollback proof.

The 3016 package also contains `/app/dist/auth-admin.mjs`,
`/app/dist/conference-readiness.mjs` and
`/app/dist/phone-provisioning-probe.mjs`; their exact hashes are in the
follow-up evidence. The probe hash is
`df4f3cc2a80e9463c03d3bf2149c16be975730cad5a203a69719cd70aad9ea52`.
Twenty-two running Node packages' top-level `/app` and `/app/dist` JS/MJS/SQL
files were metadata-pinned. Their behavior, deeper files, dynamic SQL and
manual use were not exhaustively reviewed. The earlier [literal writer
scan](EXTENSION-WRITER-INVENTORY-20261001.md) retains that same limitation.

## Database principals, authentication and host access

`phone11ai` is the **only LOGIN role**. It owns the database, extension table
and extension sequence, and has SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB and
REPLICATION. All extension INSERT/UPDATE/DELETE and column privileges resolve
true for it. `extensions` has no explicit table/column ACL, no RLS policies,
and no RLS enforcement. The predefined NOLOGIN `pg_write_all_data` role also
has effective write privileges, but no membership grants it to another login.
The only explicit role memberships are the standard `pg_monitor` reader
memberships. PUBLIC has schema USAGE; `pg_database_owner` and `phone11ai` have
schema CREATE. Catalog/default ACL evidence was captured rather than inferred
from source.

Twenty-two configured Node application/worker containers all specify this
same target database/user and hold byte-identical target credentials. The
snapshot equivalence label is evidence of equality, not a password fingerprint
or proof that every container connected during the audit. Docker listed 35
containers in total: 29 running and six stopped. The full name/ID/image/mount,
network, profile and stopped-artifact inventory is private evidence; an
unconfigured profile does not establish absence of an embedded or dynamically
obtained credential.

The database listens on `*` **inside its container**; Docker publishes only
`127.0.0.1:5432`, confirmed by the host listener snapshot. Its network address
is `172.18.0.2`. HBA accepts local all-database/all-user connections using
`trust`, local replication using `trust`, loopback TCP using SCRAM, and the
final all-address/all-database/all-user TCP rule using SCRAM. SSL is off.
The attached EC2 security group has no TCP 5432 ingress rule. This narrows
observed direct exposure; it does not close Docker-network clients, host
loopback, SSH forwarding, IAM/SSM access or external credential holders.

The activity sample had empty `application_name` for all clients: 27 idle
sessions via bridge gateway `172.18.0.1`, one from public 3016 at
`172.18.0.20`, two from baseline backend at `172.18.0.4`, and one from profile
photo worker at `172.18.0.10`. The gateway source remains insufficient to
identify every actor. Connection/disconnection and statement logging are off;
no retrospective complete writer history was established.

Host `ubuntu` belongs to Docker and sudo groups and has NOPASSWD ALL access.
`root` and `ubuntu` each have one recognized authorized SSH key. The effective
SSH configuration permits public-key authentication and root login without a
password; password and keyboard-interactive authentication are off. SSH also
has an EC2 Instance Connect service drop-in, and the Amazon SSM agent is active.
Key ownership, IAM principals capable of EIC/SSM, automated external jobs and
credential distribution were not bounded by this audit.

Sixteen standard cron files and 18 systemd timers were metadata-pinned, with
no literal Phone11/CP11/PostgreSQL/psql/Docker/Kamailio references in those
scheduled files. This is a bounded reference scan; it cannot exclude generic
wrappers or manual commands. The service inventory additionally found active,
enabled `/etc/systemd/system/phone11ai-backend.service` running as `ubuntu`.
Its executable, runtime DB access and dependencies remain an explicit gap.
A failed static root service named
`phone11-voicemail-cookie-canary-adc61255add7f607.service` was also retained;
its future/manual invocation was not bounded. No `atq` binary was available.

The pinned Kamailio config retains connection profiles for both the local
`172.18.0.2` database and a separate production RDS endpoint, each naming
`phone11ai`. The RDS target is outside this database audit. No RDS query or
provider action was attempted. A local session or configured URL is not proof
that Kamailio writes extensions or that no other writer exists.

## Actual schema and next permitted work

The target still has four extensions, zero NULL tenant assignments and zero
orphan assignments. `tenant_id` remains nullable integer `DEFAULT 1`, with no
extension tenant FK. All nine advanced-routing tables are absent. Seven
noninternal extension triggers remain enabled; no extension rules or policies
were found. Eight non-system functions, their owners/ACLs/security-definer
flags and definition hashes were inventoried. That metadata does not establish
absence of dynamic or indirect writes.

The fixture-only aggregate also confirmed one active tenant, both approved
pilot users having active membership, and zero approved pilot users with an
active denied tenant. No real second-active-tenant denial fixture exists for
those users. No tenant or membership was created.

The minimal safe continuation is:

1. Obtain an accountable allowed-writer and retained-release register covering
   all 22 credential-bearing Node containers, Kamailio, the active host
   service, packaged tools, manual/operator access, IAM/EIC/SSM actors and
   external holders. Select and pin the exact intended active and rollback
   set, including a recreatable recovery deployment. Shared superuser access
   cannot enforce separate writer identities; any retirement, credential
   rotation or least-privilege role change needs a separate reviewed operator
   plan and action-time authority.
2. Establish one protected nonproduction clone of the fresh actual target,
   including schema/trigger definitions and the intended access profile. A
   stopped `cp11-direct-restore-20260926` container was observed; its age,
   protection and operator scope were not admitted, and it was not started.
   The previously documented restore excluded owners/ACLs and is not this
   rehearsal. Use clone-only credentials and authenticate application tests
   as the intended restricted role; bootstrap-superuser tests cannot prove
   runtime-role behavior.
3. Pin the SQL digests below and independently review one clone operator plan.
   Run the legacy-default prerequisite on its own fresh idle connection with
   exact clone database/schema pins and the explicit reviewed acknowledgement;
   run advanced routing as a separate later transaction. Both files own their
   BEGIN/COMMIT. Require compatible read-only PBX preflight, both actual
   extension-create paths in each selected active/rollback artifact, an
   omitted-tenant failure, cross-tenant rejection and fresh/partial-schema
   initializer checks. Use no production fixture writes for these checks.
4. Verify restore and rollback behavior on that same clone, including
   application access after both transactions and re-admission of the exact
   predecessor. Capture catalog/access before and after. Independent operator
   review and action-time authority remain prerequisites for any later live
   schema/access/route action. Restoring DEFAULT 1 is not a substitute for a
   reviewed data and schema rollback.

| Current source gate | SHA-256 |
| --- | --- |
| `server/pbx/extension-tenant-legacy-default-prerequisites.sql` | `2deb0b79fa7d00aea093ba7c00099a99f8df7a756700c001579c94439207bed8` |
| `server/pbx/extension-tenant-prerequisites.sql` | `73c632bb49e6d45645c3cfbd85923ef6ab6db386e531647e74f103c6efd41749` |
| `server/pbx/advanced-routing-migration.sql` | `e5675dfe34bfdd2ce76a12dc1c6b4d848edd36e34908962deb39c0d8f470ee96` |
| `scripts/phone11-pbx-schema-preflight.ts` | `76738137a3794f0084ce7c0863a2c4218b3aa078085859f8f74c71472635fab6` |

This follow-up closes the fresh known-artifact/access snapshot. It does not
close writer ownership, clone admission, migration/rollback behavior,
production commissioning, provider admission or physical-device acceptance.
