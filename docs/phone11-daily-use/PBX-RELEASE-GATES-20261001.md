# Phone11 advanced PBX release gates — 1 October 2026

For the later enforcement fix and changed source/rehearsal pins, see
[advanced foreign-key enforcement](PBX-EFFECTIVE-FOREIGN-KEYS-20261007.md).

This is a source and evidence inventory at `54ceaa265bb6ca37791c14ac29f98bf2a0fe0093`, not authorization to change the PBX. The 30 September actual-target read reported a nullable `public.extensions.tenant_id DEFAULT 1`, four non-NULL assignments, no extension tenant FK, and all nine advanced-routing tables absent. The PBX preflight therefore reported `incompatible`; zero NULL rows do not make the column safe. See [the target read](EC2-CANDIDATE-RELEASE-PLAN-20260929.md) and [the catalog/DDL boundary](PBX-EXTENSION-TENANT-REPAIR-20260930.md).

## Smallest safe local gate now

Pin the source and inventory the *known* writer entry points and operator files without connecting to a database or running a migration:

```sh
git rev-parse HEAD
shasum -a 256 server/pbx/extension-tenant-legacy-default-prerequisites.sql server/pbx/advanced-routing-migration.sql scripts/phone11-pbx-schema-preflight.ts
rg -n 'INSERT INTO extensions|CREATE TABLE IF NOT EXISTS extensions|ADD COLUMN IF NOT EXISTS tenant_id' server/pbx/pbx-router.ts server/phone-provisioning.ts
```

The two current source extension-create paths supply `tenant_id` explicitly ([admin PBX](../../server/pbx/pbx-router.ts), [phone provisioning](../../server/phone-provisioning.ts)). Provisioning also retains a legacy initializer that can introduce `DEFAULT 1` on a fresh or partial schema. The [running-artifact inventory](EXTENSION-WRITER-INVENTORY-20261001.md) pinned 21 packaged `index.mjs` files and found two literal tenant-explicit inserts per bundle, including public 3016. That is a bounded text scan, not proof that dynamic SQL, dormant packaged entry points, host jobs, external clients, or a future route/rollback cannot write `extensions`. The activity snapshot used a shared superuser with empty `application_name` and could not map every writer to an accountable principal.

Record an exact active **and rollback** image/route set and obtain an authoritative inventory of every principal allowed to insert or update `public.extensions`, including host-loopback access, scheduled/manual jobs, other packaged entry points, and external clients. This requires a separate authorized read-only target/host audit; the local commands above cannot supply it. If any writer or rollback path can omit `tenant_id`, keep the live default and advanced migration blocked until its behavior is resolved. Do not treat a sampled `pg_stat_activity` window or a literal bundle match as proof of absence.

## Next gated rehearsal, after writer ownership is closed

The separate [legacy-default upgrade candidate](LEGACY-TENANT-DEFAULT-UPGRADE-CANDIDATE-20261001.md) now handles only the observed `DEFAULT 1` prestate: it requires exact database/schema pins and an explicit acknowledgement, removes that default, sets NOT NULL, and validates the same-schema FK. The [advanced migration](../../server/pbx/advanced-routing-migration.sql) is a later, distinct transaction. Both own `BEGIN`/`COMMIT` and require a fresh idle connection, as [the catalog-correction note](PBX-MIGRATION-CATALOG-CORRECTIONS-20261001.md) explains. Neither is a live command for this gate.

The previously protected PostgreSQL 16 restore matched seven pinned migration definitions; it excluded owners/ACLs and did **not** rehearse this new legacy-default transaction followed by advanced routing. Synthetic tests for the legacy transaction and advanced migration cover isolated catalog and concurrency cases, but do not prove actual-target writer, role, rollback, or tenant behavior. Do not repeat the earlier one-copy restore merely to replay a passing check. When an approved protected clone of the exact current target and its access profile is available, propose one bounded rehearsal: pin the clone and both SQL digests; run the legacy-default transaction then advanced migration in order; require compatible [PBX preflight](../../scripts/phone11-pbx-schema-preflight.ts) readback; exercise both explicit-tenant extension-create paths in each retained rollback artifact plus an omitted-tenant failure; inspect fresh/partial-schema initializer behavior and application-role access. Capture non-secret before/after catalog and rollback evidence. This needs a separate operator plan and independent review; it was not run here.

Until the authoritative writer/rollback inventory, protected-clone rehearsal, and operator review pass, do no production DDL or advanced routing activation. Source, synthetic database, protected clone, live database, provider, and handset evidence remain separate. See the [non-production two-tenant PBX pilot](NONPRODUCTION-TWO-TENANT-PBX-PILOT-20260916.md) for later call and isolation acceptance; this note does not claim those results.
