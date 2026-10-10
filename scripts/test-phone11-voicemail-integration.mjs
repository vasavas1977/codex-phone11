import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const test = "tests/phone11-voicemail-integration.test.ts";
const sourceFiles = [test, "scripts/test-phone11-voicemail-integration.mjs",
  "scripts/phone11-voicemail-producer.ts", "scripts/phone11-voicemail-relay.ts",
  "server/pbx/recording-storage.ts", "server/pbx/integration-auth.ts", "server/pbx/media-access.ts",
  "server/pbx/voicemail-filesystem.ts", "server/pbx/voicemail-storage-migration.sql"];
const expectedTitles = [
  "replays durable admission and delivery across recreated clients/backend routes, then streams an authorized seek",
  "refuses cross-tenant UUID replay and wrong-mailbox publication before storing any media",
  "streams the checked descriptor without reopening a pathname replaced after custody checks",
  "refuses a foreign symlink introduced between path inspection and descriptor open",
];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--results-dir" && isAbsolute(args[1])),
  "Usage: node scripts/test-phone11-voicemail-integration.mjs [--results-dir ABSOLUTE_DIRECTORY]");
const resultParent = args[1] ?? process.env.RUNNER_TEMP ?? tmpdir();
const evidence = await mkdtemp(join(resultParent, "phone11-voicemail-integration-results-"));
await chmod(evidence, 0o700);
// Keep the socket short even when the checkout/evidence path is long.
const root = await mkdtemp("/tmp/phone11-vm-integration-pg-");
await chmod(root, 0o700);
const rootReal = await realpath(root), rootIdentity = await lstat(root);
const data = join(root, "data"), socket = join(root, "socket"), port = "55443";
await mkdir(socket, { mode: 0o700 });
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, LANG: "C", LC_ALL: "C", NODE_ENV: "test" };
if (process.env.CI === "true") env.CI = "true";
const receipt = { scope: "source_component_integration_only", syntheticSignInPrincipal: true,
  realSignInAcceptance: false, productionCustodyAcceptance: false, tcpListener: false,
  evidence, ownedRoot: root, commands: [] };
let bin, startAttempted = false, failure;
const commandLogs = [];
function command(cmd, commandArgs, { allowFailure = false, timeout = 30_000, childEnv = env } = {}) {
  const result = spawnSync(cmd, commandArgs, { cwd: repo, env: childEnv, encoding: "utf8", timeout });
  const name = `command-${receipt.commands.length + 1}.log`;
  // Generated fixture outputs only; no inherited credentials/configuration.
  const record = { argv: [cmd, ...commandArgs], exit: result.status, error: result.error?.code ?? null, log: name };
  receipt.commands.push(record);
  commandLogs.push(writeFile(join(evidence, name), (result.stdout ?? "") + (result.stderr ?? "")));
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${name}: command failed (${result.error?.code ?? result.status})`);
  return result;
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function sourceBinding() {
  const head = command("git", ["rev-parse", "HEAD"]).stdout.trim();
  assert.match(head, /^[a-f0-9]{40}$/);
  const files = {};
  for (const name of sourceFiles) {
    const bytes = await readFile(join(repo, name));
    const committed = command("git", ["show", `HEAD:${name}`], { allowFailure: true });
    const matchesCommit = committed.status === 0 && Buffer.from(committed.stdout).equals(bytes);
    if (process.env.CI === "true") assert.ok(matchesCommit, `${name} must match the checked-out CI commit`);
    files[name] = { sha256: digest(bytes), bytes: bytes.length, matchesCommit };
  }
  return { head, files };
}
try {
  receipt.sourceBefore = await sourceBinding();
  const config = command("pg_config", ["--bindir"], { allowFailure: true });
  bin = process.env.PHONE11_TEST_PG_BIN ?? (config.status === 0 ? config.stdout.trim() : "/opt/homebrew/opt/postgresql@17/bin");
  assert.ok(isAbsolute(bin), "PostgreSQL binaries must resolve to an existing absolute directory");
  receipt.postgresVersion = command(join(bin, "postgres"), ["--version"]).stdout.trim();
  command(join(bin, "initdb"), ["-D", data, "-U", "phone11_test", "--auth-local=trust", "--auth-host=reject", "--no-locale", "-E", "UTF8"]);
  startAttempted = true;
  command(join(bin, "pg_ctl"), ["-D", data, "-l", join(evidence, "postgres.log"), "-o",
    `-h '' -k ${socket} -p ${port} -c unix_socket_permissions=0700`, "-w", "start"]);
  command(join(bin, "createdb"), ["-h", socket, "-p", port, "-U", "phone11_test", "phone11_voicemail_test"]);
  const isolation = command(join(bin, "psql"), ["-h", socket, "-p", port, "-U", "phone11_test", "-d", "phone11_voicemail_test", "-Atc",
    "SHOW listen_addresses; SHOW unix_socket_directories; SHOW unix_socket_permissions;"]);
  assert.equal(isolation.stdout, `\n${socket}\n0700\n`, "PostgreSQL must expose only the owned private Unix socket");
  receipt.testEnv = { PHONE11_VOICEMAIL_INTEGRATION_SOCKET: socket, PHONE11_VOICEMAIL_INTEGRATION_PORT: port };
  const reportPath = join(evidence, "vitest.json");
  const result = command(process.execPath, ["node_modules/vitest/vitest.mjs", "run", test, "--maxWorkers=1", "--minWorkers=1",
    "--reporter=default", "--reporter=json", `--outputFile=${reportPath}`],
  { timeout: 120_000, childEnv: { ...env, ...receipt.testEnv } });
  assert.equal(result.status, 0);
  const reportBytes = await readFile(reportPath), report = JSON.parse(reportBytes.toString("utf8"));
  assert.equal(report.success, true);
  for (const [key, value] of Object.entries({ numTotalTests: 4, numPassedTests: 4, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }))
    assert.equal(report[key], value, `${key}: required four passes and zero failures/skips/todos`);
  assert.equal(report.testResults.length, 1, "Exactly the required integration file must execute");
  const suite = report.testResults[0];
  assert.equal(resolve(suite.name), join(repo, test));
  assert.equal(suite.status, "passed");
  assert.equal(suite.assertionResults.length, 4);
  assert.deepEqual(suite.assertionResults.map(item => item.title).sort(), [...expectedTitles].sort());
  assert.ok(suite.assertionResults.every(item => item.status === "passed"), "No skipped or pending case may satisfy this gate");
  receipt.sourceAfter = await sourceBinding();
  assert.deepEqual(receipt.sourceAfter, receipt.sourceBefore, "Source must remain bound across execution");
  receipt.reportSha256 = digest(reportBytes);
  receipt.counts = { passed: 4, failed: 0, skipped: 0, todo: 0 };
  receipt.testsPassed = true;
} catch (error) {
  failure = error;
  receipt.error = error.message;
} finally {
  try {
    const current = await lstat(root);
    assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === rootIdentity.dev && current.ino === rootIdentity.ino && await realpath(root) === rootReal,
      "Cleanup refuses changed owned directory identity");
    if (startAttempted) {
      let status = command(join(bin, "pg_ctl"), ["-D", data, "status"], { allowFailure: true });
      if (status.status === 0) {
        command(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
        status = command(join(bin, "pg_ctl"), ["-D", data, "status"], { allowFailure: true });
      }
      assert.equal(status.status, 3, "Owned PostgreSQL must be confirmed stopped before removal");
      receipt.ownedPostgresStopped = true;
    }
    await rm(root, { recursive: true, force: false });
    receipt.ownedRootRemoved = true;
  } catch (error) {
    receipt.cleanupError = error.message;
    failure ??= error;
  }
  // Finish all command-log writes before sealing the receipt.
  // The source/report hashes stay available after disposable data cleanup.
  try { await Promise.all(commandLogs); }
  catch (error) { receipt.logWriteError = error.message; failure ??= error; }
  receipt.accepted = Boolean(receipt.testsPassed && receipt.ownedPostgresStopped && receipt.ownedRootRemoved && !failure);
  await writeFile(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
}
console.log(`Voicemail integration: ${receipt.accepted ? "4 passed, 0 skipped" : "FAILED"}; receipt ${join(evidence, "receipt.json")}`);
if (failure) { console.error(receipt.cleanupError ? "Owned cleanup failed; preserve evidence and diagnose before retry" : receipt.error); process.exitCode = 1; }
