import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const usage = `Usage: node scripts/verify-phone11-daily-pilot-ipa.mjs <candidate.ipa> \\
  --baseline-ipa <Phone11-49.ipa> [--allow-baseline]`;

const args = process.argv.slice(2);
const candidate = args[0] && resolve(args[0]);
const baselineIndex = args.indexOf("--baseline-ipa");
const baseline = baselineIndex >= 0 && args[baselineIndex + 1] ? resolve(args[baselineIndex + 1]) : null;
const allowBaseline = args.includes("--allow-baseline");

if (!candidate || !baseline || baselineIndex < 0 || args.length !== 3 + Number(allowBaseline)) {
  throw new Error(usage);
}

function unpack(ipa, destination) {
  if (!existsSync(ipa)) throw new Error("IPA file is missing");
  const entries = execFileSync("unzip", ["-Z1", ipa], { encoding: "utf8" }).trim().split("\n");
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) {
    throw new Error("IPA contains an unsafe archive path");
  }
  execFileSync("unzip", ["-q", ipa, "-d", destination]);
  const payload = join(destination, "Payload");
  const apps = readdirSync(payload).filter((entry) => entry.endsWith(".app"));
  if (apps.length !== 1) throw new Error("IPA must contain exactly one app");
  return join(payload, apps[0]);
}

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    cwd: resolve("."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const scratch = mkdtempSync(join(tmpdir(), "phone11-daily-pilot-ipa-"));
try {
  const candidateApp = unpack(candidate, join(scratch, "candidate"));
  const baselineApp = unpack(baseline, join(scratch, "baseline"));

  // The native verifier checks the framework linkage and bridge symbols. The
  // Python gate compares the signed configuration with the known-good Build 49.
  const native = JSON.parse(run(process.execPath, ["scripts/verify-siprix-ipa.mjs", candidate]));
  const signed = JSON.parse(run("python3", [
    "scripts/check-phone11-ios-release.py",
    candidateApp,
    "--baseline-app", baselineApp,
    "--baseline-ipa", baseline,
    ...(allowBaseline ? ["--allow-baseline"] : []),
  ]));

  const passed = native.codeSignatureVerified === true && signed.passed === true;
  process.stdout.write(`${JSON.stringify({
    passed,
    candidateIpa: basename(candidate),
    baselineIpa: basename(baseline),
    native,
    signed,
    handsetRuntimeVerified: false,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
