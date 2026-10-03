#!/usr/bin/env node
/** Disposable, socket-only PostgreSQL 17 rehearsal. No URL or customer input. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyAuthMigration } from "../server/_core/phone11-auth-admin";
import { inspectPlainVideoAdmissionSchema } from "./phone11-plain-video-admission-preflight";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseName = "phone11_meeting_chain_rehearsal";
const port = 55438;
const user = userInfo().username;
const temp = mkdtempSync(join(tmpdir(), "phone11-meeting-chain-"));
const data = join(temp, "data");
const socket = join(temp, "socket");
const log = join(temp, "postgres.log");
let started = false;
let pool: Pool | undefined;

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "pipe", timeout: 30_000 });
}

async function apply(path: string) {
  const sql = readFileSync(join(root, path), "utf8");
  await pool!.query(sql);
  console.log(`applied ${path}`);
}

async function assertCatalog() {
  const result = await pool!.query(`SELECT
    (SELECT column_default='false' FROM information_schema.columns
      WHERE table_schema='public' AND table_name='phone11_chat_members'
        AND column_name='can_start_meeting') AS permission_defaults_false,
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND
      tgname IN ('phone11_channel_meeting_member_removal',
        'phone11_direct_meeting_block_pair')) AS lifecycle_triggers,
    (SELECT count(*) FROM pg_constraint WHERE contype='f' AND
      conrelid IN ('phone11_channel_meetings'::regclass,
        'phone11_channel_meeting_invitations'::regclass)) AS meeting_fks`);
  const row = result.rows[0];
  if (!row.permission_defaults_false || Number(row.lifecycle_triggers) !== 2 ||
      Number(row.meeting_fks) < 5) throw new Error("Meeting catalog contract failed");
}

async function main() {
try {
  if (process.argv.length !== 2) throw new Error("This rehearsal takes no database arguments");
  run("postgres", ["--version"]);
  const version = execFileSync("postgres", ["--version"], { encoding: "utf8" });
  if (!/PostgreSQL\) 17\./.test(version)) throw new Error("PostgreSQL 17 is required");
  mkdirSync(socket);
  run("initdb", ["-A", "trust", "-U", user, "--no-instructions", "-D", data]);
  run("pg_ctl", ["-D", data, "-l", log, "-o",
    `-c listen_addresses='' -c unix_socket_directories='${socket}' -p ${port}`, "-w", "start"]);
  started = true;
  run("createdb", ["-h", socket, "-p", String(port), "-U", user, databaseName]);
  pool = new Pool({ host: socket, port, user, database: databaseName, max: 3 });
  const identity = await pool.query(`SELECT current_database() AS db,
    inet_server_addr() IS NULL AS socket_only,
    current_setting('server_version_num')::integer AS version`);
  if (identity.rows[0]?.db !== databaseName || !identity.rows[0]?.socket_only ||
      identity.rows[0]?.version < 170000 || identity.rows[0]?.version >= 180000)
    throw new Error("Refusing non-disposable PostgreSQL target");

  await apply("server/meetings/rehearsal-foundation.sql");
  await apply("server/cloud-recordings/prerequisites.sql");
  await applyAuthMigration(pool, {
    baseURL: "http://localhost:19438", secret: "disposable-phone11-meeting-chain-only-2026",
    trustedOrigins: ["http://localhost:19438"],
  });
  console.log("applied owned-auth migration via applyAuthMigration");
  for (const path of [
    "server/chat/migration.sql",
    "server/chat/collaboration-migration.sql",
    "server/chat/media-migration.sql",
    "server/chat/read-receipts-migration.sql",
  ]) await apply(path);

  const client = await pool.connect();
  try {
    const before = await inspectPlainVideoAdmissionSchema(client);
    if (!before.pass || before.outcome !== "ready_for_migration")
      throw new Error(`Plain-video preflight before migration: ${JSON.stringify(before)}`);
  } finally { client.release(); }
  console.log("plain-video preflight: ready_for_migration");

  await apply("server/meetings/plain-video-admission-migration.sql");
  const afterClient = await pool.connect();
  try {
    const after = await inspectPlainVideoAdmissionSchema(afterClient);
    if (!after.pass || after.outcome !== "already_applied") {
      const indexes = await afterClient.query(`SELECT indexname,indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname LIKE 'phone11_plain_video_%pending'`);
      throw new Error(`Plain-video preflight after migration: ${JSON.stringify(after)}; indexes=${JSON.stringify(indexes.rows)}`);
    }
  } finally { afterClient.release(); }
  console.log("plain-video preflight: already_applied");
  await apply("server/meetings/channel-meeting-migration.sql");
  await apply("server/meetings/direct-meeting-migration.sql");
  await assertCatalog();
  console.log("PASS disposable Phone11 auth/chat/plain-video/channel/direct migration chain");
} finally {
  await pool?.end();
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(temp, { recursive: true, force: true });
}
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Meeting chain rehearsal failed");
  process.exitCode = 1;
});
