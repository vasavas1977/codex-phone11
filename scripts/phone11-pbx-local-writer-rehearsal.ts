/** Disposable local PBX rehearsal. Never connects to a production or shared DB. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { inspectPbxSchema } from "./phone11-pbx-schema-preflight";

type Credential = { user: string; password: string };
type Config = { host: "127.0.0.1"; port: number; database: "phone11_pbx_test";
  containerId: string; image: string; network: string; runId: string;
  operator: Credential; writer: Credential; reader: Credential; outsider: Credential;
  auditPath: string; auditSha256: string; outputPath: string };
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const cases: { name: string; status: "passed" | "observed_gap"; sqlstate?: string }[] = [];
let stage = "configuration";
function record(name: string, status: "passed" | "observed_gap" = "passed", sqlstate?: string) {
  cases.push({ name, status, ...(sqlstate ? { sqlstate } : {}) });
}
function secureJson(path: string) {
  const info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
  assert.equal(info.uid, process.getuid!());
  assert.equal(info.mode & 0o777, 0o600);
  return JSON.parse(readFileSync(path, "utf8"));
}
const configPath = process.env.PHONE11_PBX_LOCAL_REHEARSAL_CONFIG;
assert(configPath && resolve(configPath) === configPath, "explicit protected local config required");
const config = secureJson(configPath) as Config;
assert.equal(config.host, "127.0.0.1");
assert.equal(config.database, "phone11_pbx_test");
assert(Number.isSafeInteger(config.port) && config.port > 1024 && config.port < 65536);
assert(/^[0-9a-f]{16}$/.test(config.runId));
assert(/^sha256:[0-9a-f]{64}$/.test(config.image));
assert(/^[0-9a-f]{64}$/.test(config.containerId));
for (const credential of [config.operator, config.writer, config.reader, config.outsider]) {
  assert(/^p11_local_[a-z]+$/.test(credential.user));
  assert(typeof credential.password === "string" && credential.password.length >= 32);
}
assert.equal(new Set([config.operator.user, config.writer.user, config.reader.user, config.outsider.user]).size, 4);
const container = JSON.parse(execFileSync("docker", ["inspect", config.containerId], { encoding: "utf8" }))[0];
assert.equal(container.Id, config.containerId);
assert.equal(container.Image, config.image);
assert.equal(container.Config.Labels["com.phone11.local-pbx-rehearsal"], config.runId);
assert.equal(container.State.Running, true);
assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: String(config.port) }]);
assert.equal(container.HostConfig.Tmpfs["/var/lib/postgresql/data"], "rw,noexec,nosuid,size=256m");
assert(!container.Mounts.some((m: { Destination: string; Type: string }) => m.Destination === "/var/lib/postgresql/data" && m.Type !== "tmpfs"));
const mountInfo = execFileSync("docker", ["exec", config.containerId, "cat", "/proc/self/mountinfo"], { encoding: "utf8" });
assert(mountInfo.split("\n").some((line) => line.split(" ")[4] === "/var/lib/postgresql/data" && line.includes(" - tmpfs ")));
assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [config.network]);
const network = JSON.parse(execFileSync("docker", ["network", "inspect", config.network], { encoding: "utf8" }))[0];
assert.equal(network.Driver, "bridge");
assert.equal(network.Internal, false);
assert.equal(network.Labels["com.phone11.local-pbx-rehearsal"], config.runId);
const auditBytes = readFileSync(config.auditPath);
assert.equal(sha(auditBytes), config.auditSha256);
const audit = auditBytes.toString().trim().split("\n").map((line) => JSON.parse(line));
const columns = audit.find((r) => r.kind === "extension_columns").rows;
const tenantColumn = columns.find((r: { attname: string }) => r.attname === "tenant_id");
assert.equal(tenantColumn.type, "integer");
assert.equal(tenantColumn.attnotnull, false);
assert.equal(tenantColumn.default_expression, "1");
assert(audit.some((r) => r.kind === "complete"));
const legacyPath = "server/pbx/extension-tenant-legacy-default-prerequisites.sql";
const advancedPath = "server/pbx/advanced-routing-migration.sql";
const legacy = readFileSync(resolve(repo, legacyPath), "utf8");
const advanced = readFileSync(resolve(repo, advancedPath), "utf8");
const sourceHashes = Object.fromEntries([legacyPath, advancedPath, "scripts/phone11-pbx-schema-preflight.ts", "scripts/phone11-pbx-local-writer-rehearsal.ts"].map((p) => [p, sha(readFileSync(resolve(repo, p)))]));
function client(credential: Credential) {
  return new Client({ host: config.host, port: config.port, database: config.database,
    user: credential.user, password: credential.password, ssl: false,
    application_name: "phone11-pbx-local-writer-rehearsal", connectionTimeoutMillis: 5000 });
}
async function connect(credential: Credential) {
  const connection = client(credential); await connection.connect();
  const identity = (await connection.query(`SELECT current_database() db,session_user,current_user,
    r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  assert.equal(identity.db, config.database);
  assert.equal(identity.session_user, credential.user);
  assert.equal(identity.current_user, credential.user);
  if (credential !== config.operator) {
    assert.equal(identity.rolsuper, false); assert.equal(identity.rolbypassrls, false);
    assert.equal(identity.rolcreaterole, false); assert.equal(identity.rolcreatedb, false);
  }
  return connection;
}
async function rejectSql(connection: Client, name: string, sql: string, sqlstate: string) {
  stage = name; await connection.query("BEGIN");
  try {
    await assert.rejects(connection.query(sql), (error: unknown) => (error as { code?: string }).code === sqlstate);
    record(name, "passed", sqlstate);
  } finally { await connection.query("ROLLBACK"); }
}
async function rolledBack(connection: Client, sql: string) {
  await connection.query("BEGIN");
  try { return await connection.query(sql); } finally { await connection.query("ROLLBACK"); }
}
async function catalog(connection: Client) {
  return (await connection.query(`SELECT a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_expression,
    c.conname,c.convalidated,c.oid::text constraint_oid,c.xmin::text constraint_xmin
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_constraint c ON c.conrelid=a.attrelid AND c.conname='phone11_extensions_tenant_fk'
    WHERE a.attrelid='public.extensions'::regclass AND a.attname='tenant_id'`)).rows[0];
}
async function runMigration(sql: string, settings: { database?: string; schema?: string; ack?: string }) {
  // A distinct fresh operator connection keeps this migration's own COMMIT isolated.
  const connection = await connect(config.operator);
  try {
    await connection.query("SELECT set_config('search_path',$1,false)", [settings.schema ?? "public"]);
    if (settings.database !== undefined) await connection.query("SELECT set_config('phone11.expected_database',$1,false)", [settings.database]);
    if (settings.schema !== undefined) await connection.query("SELECT set_config('phone11.expected_schema',$1,false)", [settings.schema]);
    if (settings.ack !== undefined) await connection.query("SELECT set_config('phone11.allow_reviewed_legacy_tenant_default_removal',$1,false)", [settings.ack]);
    try { await connection.query(sql); } catch (error) { await connection.query("ROLLBACK"); throw error; }
  } finally { await connection.end(); }
}
async function main() {
  let operator: Client | undefined, writer: Client | undefined, reader: Client | undefined, outsider: Client | undefined;
  try {
    stage = "synthetic fixture";
    operator = await connect(config.operator);
    await operator.query("REVOKE ALL ON DATABASE phone11_pbx_test FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    for (const role of [config.writer, config.reader, config.outsider]) {
      // Names are strict identifiers; password is encoded as a SQL literal only in this disposable DB.
      const password = "'" + role.password.replaceAll("'", "''") + "'";
      await operator.query(`CREATE ROLE ${role.user} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${password}`);
      await operator.query(`GRANT CONNECT ON DATABASE phone11_pbx_test TO ${role.user}`);
    }
    // Extension column names/types/defaults are from the live metadata snapshot; no live row is copied.
    const definitions = columns.map((column: { attname: string; type: string; attnotnull: boolean; default_expression: string | null }) => {
      assert(/^[a-z_]+$/.test(column.attname));
      assert(/^[a-z0-9_ ()]+$/.test(column.type));
      return `${column.attname} ${column.type}${column.attnotnull ? " NOT NULL" : ""}${column.default_expression ? " DEFAULT " + column.default_expression : ""}`;
    });
    await operator.query(`CREATE TABLE public.tenants(id INTEGER PRIMARY KEY,name TEXT,plan TEXT,status TEXT);
      CREATE SEQUENCE public.extensions_id_seq;
      CREATE TABLE public.extensions(${definitions.join(",")},CONSTRAINT extensions_pkey PRIMARY KEY(id));
      ALTER SEQUENCE public.extensions_id_seq OWNED BY public.extensions.id;
      CREATE TABLE public.tenant_memberships(user_id INTEGER,tenant_id INTEGER,status TEXT);
      CREATE TABLE public.user_extensions(user_id INTEGER,extension_id INTEGER,is_primary BOOLEAN);
      CREATE TABLE public.organizations(id INTEGER,name TEXT,plan TEXT);
      CREATE TABLE public.sip_accounts(id INTEGER,extension_id INTEGER,tenant_id INTEGER,user_id INTEGER,
        sip_username TEXT,sip_domain TEXT,ha1 TEXT,ha1b TEXT,secret_ciphertext BYTEA,
        secret_iv BYTEA,secret_tag BYTEA,transport_preference TEXT,status TEXT,deleted_at TIMESTAMPTZ);
      CREATE TABLE public.subscriber(username TEXT,domain TEXT,password TEXT,ha1 TEXT,ha1b TEXT);
      CREATE TABLE public.did_numbers(tenant_id INTEGER,destination_type TEXT,destination_value TEXT,
        status TEXT,number TEXT,description TEXT);
      INSERT INTO public.tenants VALUES (1,'Synthetic A','test','active'),(2,'Synthetic B','test','active');
      INSERT INTO public.extensions(id,tenant_id,extension_number) VALUES(100,1,'9100'),(101,1,'9101'),(200,2,'9200'),(201,2,'9201');
      GRANT USAGE ON SCHEMA public TO ${config.writer.user},${config.reader.user};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${config.writer.user},${config.reader.user};
      GRANT INSERT,UPDATE,DELETE ON public.extensions TO ${config.writer.user};
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${config.writer.user}`);
    writer = await connect(config.writer); reader = await connect(config.reader); outsider = await connect(config.outsider);
    record("three distinct restricted LOGIN identities verified without SET ROLE");
    const badPassword = client({ user: config.writer.user, password: "deliberately-incorrect-local-rehearsal-password" });
    try {
      await assert.rejects(badPassword.connect(), (error: unknown) => (error as { code?: string }).code === "28P01");
      record("restricted LOGIN rejects incorrect password through TCP SCRAM", "passed", "28P01");
    } finally { await badPassword.end().catch(() => undefined); }
    const before = await catalog(operator);
    assert.equal(before.attnotnull, false); assert.equal(before.default_expression, "1"); assert.equal(before.conname, null);
    const beforePreflight = await inspectPbxSchema(reader);
    assert.equal(beforePreflight.overall, "incompatible"); assert.equal(beforePreflight.advanced.status, "absent");
    record("observed legacy prestate is incompatible in read-only preflight");
    const omitted = await rolledBack(writer, "INSERT INTO public.extensions(extension_number) VALUES('9199') RETURNING tenant_id");
    assert.equal(omitted.rows[0].tenant_id, 1);
    record("legacy default silently assigns omitted tenant to synthetic tenant 1", "observed_gap");
    for (const [name, settings] of [
      ["legacy refuses missing database pin", { schema: "public", ack: "true" }],
      ["legacy refuses mismatched database pin", { database: "wrong_local_db", schema: "public", ack: "true" }],
      ["legacy refuses missing schema pin", { database: config.database, ack: "true" }],
      ["legacy refuses missing removal acknowledgement", { database: config.database, schema: "public" }],
    ] as const) {
      stage = name; await assert.rejects(runMigration(legacy, settings), (error: unknown) => (error as {code?:string}).code === "55000");
      assert.deepEqual(await catalog(operator), before); record(name, "passed", "55000");
    }
    stage = "raw advanced migration prerequisite boundary";
    await operator.query(`CREATE SCHEMA pbx_unsafe_order;
      CREATE TABLE pbx_unsafe_order.tenants(id INTEGER PRIMARY KEY);
      CREATE TABLE pbx_unsafe_order.extensions(id INTEGER PRIMARY KEY,tenant_id INTEGER DEFAULT 1,
        extension_number TEXT NOT NULL,display_name TEXT,deleted_at TIMESTAMPTZ)`);
    await runMigration(advanced, { database: config.database, schema: "pbx_unsafe_order" });
    const unsafe = (await operator.query(`SELECT a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_expression,
      to_regclass('pbx_unsafe_order.ivr_menus') IS NOT NULL advanced_installed,
      (SELECT count(*)::int FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='f') tenant_fks
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='pbx_unsafe_order.extensions'::regclass AND a.attname='tenant_id'`)).rows[0];
    assert.deepEqual(unsafe, { attnotnull: false, default_expression: "1", advanced_installed: true, tenant_fks: 0 });
    record("raw advanced SQL accepts legacy base prestate; prerequisite preflight/operator gate remains required", "observed_gap");
    await operator.query("DROP SCHEMA pbx_unsafe_order CASCADE");
    assert.deepEqual(await catalog(operator), before);
    assert.equal((await operator.query("SELECT to_regclass('public.ivr_menus') name")).rows[0].name, null);
    stage = "standalone legacy prerequisite";
    await runMigration(legacy, { database: config.database, schema: "public", ack: "true" });
    const upgraded = await catalog(operator);
    assert.equal(upgraded.attnotnull, true); assert.equal(upgraded.default_expression, null); assert.equal(upgraded.convalidated, true);
    record("standalone legacy migration enforces explicit valid tenant");
    await runMigration(legacy, { database: config.database, schema: "public", ack: "true" });
    assert.deepEqual(await catalog(operator), upgraded); record("exact legacy replay preserves FK OID and xmin");
    await rejectSql(writer, "omitted tenant fails after prerequisite", "INSERT INTO public.extensions(extension_number) VALUES('9199')", "23502");
    await rejectSql(writer, "orphan tenant fails after prerequisite", "INSERT INTO public.extensions(tenant_id,extension_number) VALUES(999,'9199')", "23503");
    assert.equal((await rolledBack(writer, "INSERT INTO public.extensions(tenant_id,extension_number) VALUES(1,'9199') RETURNING tenant_id")).rows[0].tenant_id, 1);
    record("restricted writer explicit tenant insert succeeds");
    stage = "advanced target refusal";
    await assert.rejects(runMigration(advanced, { database: config.database }), (error: unknown) => (error as {code?:string}).code === "55000");
    assert.equal((await operator.query("SELECT to_regclass('public.ivr_menus') name")).rows[0].name, null); record("advanced missing schema pin refuses before DDL", "passed", "55000");
    stage = "standalone advanced migration";
    await runMigration(advanced, { database: config.database, schema: "public" });
    await operator.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${config.writer.user},${config.reader.user};
      GRANT INSERT,UPDATE,DELETE ON public.ivr_menus,public.ivr_actions,public.ring_groups,public.ring_group_members,
        public.call_queues,public.queue_agents,public.queue_stats,public.time_conditions,public.time_condition_rules TO ${config.writer.user};
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${config.writer.user}`);
    const readerPreflightAfter = await inspectPbxSchema(reader);
    assert.equal(readerPreflightAfter.overall, "incompatible");
    assert(readerPreflightAfter.advanced.issues.length > 0 && readerPreflightAfter.advanced.issues.every((issue) => issue.endsWith(":primary_key")));
    record("SELECT-only reader preflight fails closed because information_schema hides primary-key metadata", "observed_gap");
    const afterPreflight = await inspectPbxSchema(writer);
    assert.equal(afterPreflight.overall, "compatible"); assert.equal(afterPreflight.advanced.status, "compatible");
    record("restricted writer read-only preflight is compatible after ordered migrations");
    await writer.query("BEGIN TRANSACTION READ ONLY");
    try {
      await assert.rejects(writer.query("INSERT INTO public.extensions(tenant_id,extension_number) VALUES(1,'9199')"),
        (error: unknown) => (error as {code?:string}).code === "25006");
      record("writer read-only transaction rejects otherwise permitted insert", "passed", "25006");
    } finally { await writer.query("ROLLBACK"); }
    await writer.query("INSERT INTO public.ring_groups(id,tenant_id,name) VALUES(10,1,'Synthetic group'); INSERT INTO public.call_queues(id,tenant_id,name) VALUES(20,1,'Synthetic queue')");
    await rejectSql(writer, "cross-tenant ring membership rejected", "INSERT INTO public.ring_group_members(ring_group_id,extension_id) VALUES(10,200)", "23514");
    await rejectSql(writer, "cross-tenant queue membership rejected", "INSERT INTO public.queue_agents(queue_id,extension_id) VALUES(20,200)", "23514");
    await writer.query("INSERT INTO public.ring_group_members(ring_group_id,extension_id) VALUES(10,100)");
    record("same-tenant membership succeeds as restricted writer");
    await rejectSql(writer, "member extension tenant move rejected", "UPDATE public.extensions SET tenant_id=2 WHERE id=100", "23514");
    await rejectSql(writer, "ring-group tenant reassignment rejected", "UPDATE public.ring_groups SET tenant_id=2 WHERE id=10", "23514");
    await rejectSql(reader, "reader cannot insert extension", "INSERT INTO public.extensions(tenant_id,extension_number) VALUES(1,'9199')", "42501");
    await rejectSql(outsider, "ungranted login cannot read extension", "SELECT id FROM public.extensions", "42501");
    await rejectSql(writer, "writer cannot create tenant", "INSERT INTO public.tenants(id,name) VALUES(999,'Forbidden')", "42501");
    await rejectSql(writer, "writer cannot create role", "CREATE ROLE p11_local_forbidden", "42501");
    await rejectSql(writer, "writer cannot grant itself to outsider", `GRANT ${config.writer.user} TO ${config.outsider.user}`, "42501");
    await rejectSql(writer, "writer cannot assume operator role", `SET ROLE ${config.operator.user}`, "42501");
    await rejectSql(writer, "writer cannot disable tenant triggers", "ALTER TABLE public.extensions DISABLE TRIGGER ALL", "42501");
    await rejectSql(writer, "writer cannot restore legacy default", "ALTER TABLE public.extensions ALTER COLUMN tenant_id SET DEFAULT 1", "42501");
    await rejectSql(writer, "writer cannot bypass trigger execution", "SET session_replication_role=replica", "42501");
    // A non-superuser alone is not a per-tenant policy: migration creates no RLS.
    assert.equal((await rolledBack(writer, "INSERT INTO public.extensions(tenant_id,extension_number) VALUES(2,'9299') RETURNING tenant_id")).rows[0].tenant_id, 2);
    record("table-granted writer can create directly in another valid tenant; actor policy remains external", "observed_gap");
    assert.equal((await rolledBack(writer, "UPDATE public.extensions SET tenant_id=2 WHERE id=101 RETURNING tenant_id")).rows[0].tenant_id, 2);
    record("unreferenced extension can move tenants; caller authorization remains external", "observed_gap");
    await runMigration(advanced, { database: config.database, schema: "public" });
    assert.equal((await inspectPbxSchema(writer)).overall, "compatible"); record("advanced migration replay remains compatible for restricted writer");
    const roleReadback = (await operator.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`, [[config.writer.user, config.reader.user, config.outsider.user]])).rows;
    assert(roleReadback.every((r) => r.rolcanlogin && !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole && !r.rolcreatedb));
    assert.equal((await operator.query("SELECT count(*)::int count FROM pg_auth_members WHERE member IN(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))", [[config.writer.user, config.reader.user, config.outsider.user]])).rows[0].count, 0);
    record("restricted role flags and zero memberships remain unchanged after negative paths");
    const result = { schema: "phone11-pbx-local-writer-rehearsal/v1", status: "completed_synthetic_only",
      capturedAt: new Date().toISOString(), database: config.database, host: config.host, port: config.port,
      containerId: config.containerId, image: config.image, network: config.network,
      serverVersion: (await operator.query("SHOW server_version_num")).rows[0].server_version_num,
      auditSha256: config.auditSha256, sourceHashes, before, upgraded, beforePreflight, afterPreflight, readerPreflightAfter,
      roleReadback, cases, passed: cases.filter((r) => r.status === "passed").length,
      observedGaps: cases.filter((r) => r.status === "observed_gap").length,
      productionAdmission: { admitted: false, missing: ["accountable live writer/credential-holder boundary", "approved recreatable active and rollback artifact set", "protected fresh actual-target clone including trigger/access profile", "independent operator review and action-time authority"] },
      limits: ["Synthetic fixture, not restored live schema or customer data", "Live seven noninternal extension triggers not restored", "Runtime grants are proposed synthetic restricted grants, not live shared superuser grants", "Actual admin/provisioning application handlers and retained images not run", "Per-actor tenant authorization and production rollback remain unproved"] };
    writeFileSync(config.outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, passed: result.passed, observedGaps: result.observedGaps,
      serverVersion: result.serverVersion, port: config.port, resultSha256: sha(readFileSync(config.outputPath)), productionAdmitted: false }));
  } finally {
    await Promise.allSettled([operator, writer, reader, outsider].map(async (c) => { if (c) await c.end(); }));
  }
}
main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "failed", stage, sqlstate: (error as { code?: string }).code ?? null,
    errorType: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
});
