import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const patchPath = path.join(root, "patches/react-native-pjsip@2.7.4.patch");
const pinnedDigest = "edf2d7a37301ffedf3c4eb41e011d4888fd890a278ffea31e4a2a75bd0dc8bee";
// Exact libs.sh from the locked npm package, including its missing final newline.
const upstream = [
  "#!/bin/bash",
  "set -e",
  "",
  "if ! type \"curl\" > /dev/null; then ",
  "    echo \"Missed curl dependency\" >&2; ",
  "    exit 1; ",
  "fi",
  "if ! type \"tar\" > /dev/null; then ",
  "    echo \"Missed tar dependency\" >&2; ",
  "    exit 1; ",
  "fi",
  "",
  "curl -LO https://github.com/datso/react-native-pjsip-builder/releases/download/v2.7.1-with-vialer/release.tar.gz",
  "tar -xvf release.tar.gz",
  "rm release.tar.gz",
].join("\n");
const fixture = Buffer.from("verified native SDK fixture\n");
const fixtureDigest = createHash("sha256").update(fixture).digest("hex");

function runFixture(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "phone11-pjsip-sdk-test-"));
  try {
    const bin = path.join(dir, "bin");
    const temporary = path.join(dir, "temporary");
    mkdirSync(bin);
    mkdirSync(temporary);
    writeFileSync(path.join(dir, "libs.sh"), upstream);
    const apply = spawnSync("git", ["apply", "--unidiff-zero", patchPath], { cwd: dir, encoding: "utf8" });
    assert.equal(apply.status, 0, apply.stderr);
    const patched = readFileSync(path.join(dir, "libs.sh"), "utf8");
    assert.equal(patched.split(pinnedDigest).length, 2, "one committed archive digest");
    // Exercise real byte hashing on a tiny fixture; never override the production pin.
    writeFileSync(path.join(dir, "libs.sh"), patched.replace(pinnedDigest, fixtureDigest));
    const syntax = spawnSync("/bin/bash", ["-n", "libs.sh"], { cwd: dir, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
    writeFileSync(path.join(dir, "payload"), options.mismatch ? "changed SDK bytes" : fixture);
    // A valid stale archive cannot satisfy a failed/mismatched fresh download.
    writeFileSync(path.join(dir, "release.tar.gz"), fixture);
    for (const name of ["mktemp", "rm"]) {
      const locate = spawnSync("/bin/bash", ["-c", `command -v ${name}`], { encoding: "utf8" });
      assert.equal(locate.status, 0, locate.stderr);
      symlinkSync(locate.stdout.trim(), path.join(bin, name));
    }
    function tool(name, body) {
      writeFileSync(path.join(bin, name), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
    }
    const log = 'const fs = require("node:fs"); const args = process.argv.slice(2);\n' +
      'fs.appendFileSync(process.env.EVENT_LOG, JSON.stringify({ tool: require("node:path").basename(process.argv[1]), args }) + "\\n");\n';
    tool("curl", log + `
const output = args[args.indexOf("--output") + 1];
fs.copyFileSync(process.env.PAYLOAD, output);
if (process.env.INTERRUPT === "1") process.kill(process.ppid, "SIGTERM");
process.exit(Number(process.env.DOWNLOAD_EXIT || 0));`);
    if (!options.missingChecksum) {
      tool(options.sha256sum ? "sha256sum" : "shasum", log + `
if (process.env.CHECKSUM_EXIT === "1") process.exit(1);
const archive = args[args.length - 1];
const digest = require("node:crypto").createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
console.log(digest + "  " + archive);`);
    }
    tool("tar", log + `
const digest = require("node:crypto").createHash("sha256").update(fs.readFileSync(args[1])).digest("hex");
if (digest !== process.env.FIXTURE_DIGEST) process.exit(77);
fs.writeFileSync("extracted", "native resources");
process.exit(Number(process.env.TAR_EXIT || 0));`);
    const result = spawnSync("/bin/bash", ["libs.sh"], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin,
        TMPDIR: temporary,
        EVENT_LOG: path.join(dir, "events"),
        PAYLOAD: path.join(dir, "payload"),
        FIXTURE_DIGEST: fixtureDigest,
        DOWNLOAD_EXIT: options.downloadFailure ? "22" : "0",
        CHECKSUM_EXIT: options.checksumFailure ? "1" : "0",
        TAR_EXIT: options.tarFailure ? "2" : "0",
        INTERRUPT: options.interrupt ? "1" : "0",
      },
    });
    assert.deepEqual(readdirSync(temporary), [], "temporary downloads cleaned on every exit");
    assert.deepEqual(readFileSync(path.join(dir, "release.tar.gz")), fixture, "stale archive untouched");
    const events = readdirSync(dir).includes("events")
      ? readFileSync(path.join(dir, "events"), "utf8").trim().split("\n").map(JSON.parse)
      : [];
    return { result, events, extracted: readdirSync(dir).includes("extracted") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("patch applies to the exact locked-package script and is registered in pnpm", () => {
  assert.equal(createHash("sha256").update(upstream).digest("hex"), "7bf2e99929528a8d177b657c72d45ac1ecc5c8ce8aa51e8116226d10301882c5");
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.pnpm.patchedDependencies["react-native-pjsip@2.7.4"], "patches/react-native-pjsip@2.7.4.patch");
  const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const metadata = lock.match(/react-native-pjsip@2\.7\.4:\n    hash: ([a-z0-9]+)\n    path: patches\/react-native-pjsip@2\.7\.4\.patch/);
  assert.ok(metadata, "lockfile includes the registered patch hash and path");
  assert.ok(lock.includes(`version: 2.7.4(patch_hash=${metadata[1]})(react-native@`), "importer selects patched package");
  assert.ok(lock.includes(`react-native-pjsip@2.7.4(patch_hash=${metadata[1]})(react-native@`), "snapshot selects the same patched package");
});

for (const sha256sum of [false, true]) {
  test(`accepts matching bytes with ${sha256sum ? "sha256sum" : "shasum"} before extracting`, () => {
    const { result, events, extracted } = runFixture({ sha256sum });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(extracted, true);
    assert.deepEqual(events.map(event => event.tool), ["curl", sha256sum ? "sha256sum" : "shasum", "tar"]);
    const args = events[0].args;
    for (const flag of ["--fail", "--location"]) assert.ok(args.includes(flag));
    assert.equal(args[args.indexOf("--proto") + 1], "=https");
    assert.equal(args[args.indexOf("--proto-redir") + 1], "=https");
    assert.equal(args.at(-1), "https://github.com/datso/react-native-pjsip-builder/releases/download/v2.7.1-with-vialer/release.tar.gz");
    assert.equal(events.at(-1).args[1], args[args.indexOf("--output") + 1]);
    assert.deepEqual(events.at(-1).args.slice(0, 1), ["-xvf"]);
  });
}

for (const [name, options, tools] of [
  ["digest mismatch", { mismatch: true }, ["curl", "shasum"]],
  ["download failure", { downloadFailure: true }, ["curl"]],
  ["missing checksum tool", { missingChecksum: true }, []],
  ["checksum tool failure", { checksumFailure: true }, ["curl", "shasum"]],
  ["interrupted download", { interrupt: true }, ["curl"]],
]) {
  test(`${name} fails without extracting or using a stale archive`, () => {
    const { result, events, extracted } = runFixture(options);
    assert.notEqual(result.status, 0);
    assert.equal(extracted, false);
    assert.deepEqual(events.map(event => event.tool), tools);
    if (options.mismatch) assert.match(result.stderr, /SHA-256 mismatch/);
    if (options.missingChecksum) assert.match(result.stderr, /Missing SHA-256 dependency/);
  });
}

test("extraction failure propagates and still cleans the verified download", () => {
  const { result, events } = runFixture({ tarFailure: true });
  assert.equal(result.status, 2);
  assert.deepEqual(events.map(event => event.tool), ["curl", "shasum", "tar"]);
});
