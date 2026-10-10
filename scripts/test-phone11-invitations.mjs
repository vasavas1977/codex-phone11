import { mkdtemp, mkdir, chmod, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Disposable PostgreSQL on a private Unix socket. Never reads production DB env.
const root = await mkdtemp("/tmp/phone11-auth-test-invitations-");
await chmod(root, 0o700);
const data = join(root, "data");
const socket = join(root, "socket");
await mkdir(socket, { mode: 0o700 });
const pgConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
const bin = process.env.PHONE11_TEST_PG_BIN ||
  (pgConfig.status === 0 ? pgConfig.stdout.trim() : "/opt/homebrew/opt/postgresql@17/bin");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(command + " failed");
  }
}
let started = false;
try {
  run(join(bin, "initdb"), ["-D", data, "-U", "phone11_test", "--auth-local=trust", "--auth-host=reject", "--no-locale", "-E", "UTF8"]);
  run(join(bin, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", "-h '' -k " + socket, "-w", "start"]);
  started = true;
  run(join(bin, "createdb"), ["-h", socket, "-U", "phone11_test", "phone11_auth_test"]);
  const tests = process.argv.slice(2);
  const result = spawnSync(resolve("node_modules/.bin/vitest"), ["run", ...(tests.length ? tests : [
    "tests/phone11-invitations.integration.test.ts",
    "tests/phone11-invitations-rate.test.ts",
    "tests/phone11-auth.integration.test.ts",
    "tests/phone11-auth-config.test.ts",
    "tests/phone11-auth-readiness.test.ts",
  ])], {
    stdio: "inherit",
    env: { ...process.env, PHONE11_TEST_PG_BIN: bin, PHONE11_AUTH_TEST_SOCKET: socket, NODE_ENV: "test" },
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  try { console.error(await readFile(join(root, "postgres.log"), "utf8")); } catch {}
  process.exitCode = 1;
} finally {
  if (started) run(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
  await rm(root, { recursive: true, force: true });
}
