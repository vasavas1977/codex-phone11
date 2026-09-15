import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ipa = process.argv[2] && resolve(process.argv[2]);
if (!ipa) throw new Error("Usage: node scripts/verify-siprix-ipa.mjs <signed.ipa>");
const entries = execFileSync("unzip", ["-Z1", ipa], { encoding: "utf8" }).trim().split("\n");
if (entries.some(entry => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("Unsafe IPA entry path");
const directory = mkdtempSync(join(tmpdir(), "phone11-siprix-ipa-"));
execFileSync("unzip", ["-q", ipa, "-d", directory]);
const apps = readdirSync(join(directory, "Payload")).filter(name => name.endsWith(".app"));
if (apps.length !== 1) throw new Error("Expected one app in IPA");
const app = join(directory, "Payload", apps[0]);
const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(app, "Info.plist")], { encoding: "utf8" }));
if (info.CFBundleIdentifier !== "space.manus.phone11ai.t20260425073427") throw new Error("Bundle identity mismatch; do not install");
const binary = join(app, info.CFBundleExecutable);
const linkage = execFileSync("otool", ["-L", binary], { encoding: "utf8" });
const core = join(app, "Frameworks", "siprix.framework", "siprix");
const transitiveLinkage = existsSync(core) ? execFileSync("otool", ["-L", core], { encoding: "utf8" }) : "";
for (const name of ["siprix", "siprixMedia"]) {
  if (!existsSync(join(app, "Frameworks", `${name}.framework`, name))) throw new Error(`Missing ${name} framework`);
  const links = name === "siprix" ? linkage : linkage + transitiveLinkage;
  if (!links.includes(`${name}.framework/${name}`)) throw new Error(`App does not link ${name}`);
}
const strings = execFileSync("strings", [binary], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
if (!strings.includes("Phone11Siprix")) throw new Error("Native Phone11Siprix class not found");
if (strings.includes("PjSipModule")) throw new Error("Legacy PJSIP bridge unexpectedly included");
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
console.log(JSON.stringify({
  ipa, app, bundleIdentifier: info.CFBundleIdentifier, version: info.CFBundleShortVersionString,
  buildNumber: info.CFBundleVersion, sha256: createHash("sha256").update(readFileSync(ipa)).digest("hex"),
  siprixFrameworksLinked: true, nativeBridgeClassPresent: true, legacyBridgeClassAbsent: true,
  codeSignatureVerified: true, handsetRuntimeVerified: false,
}, null, 2));
