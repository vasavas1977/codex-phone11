import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const revision = "53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce";
export const archiveSha256 = "c1dcea4eb129f1a7a4e46463185b53e6b1b98f9a619e952f4e5c530af5e7aa41";
const binaries = {
  siprix: "e46cc2aa751037b765d98dfc661d520b7a4717f59f9347de3ee295e72b2b9d7f",
  siprixMedia: "52fe237d7224304c0e7ad3bba4d0e404ea1078dc959baf93465bd2d29cf418e8",
};
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "modules/phone11-siprix/vendor");

export function verifyBinaries(directory) {
  for (const [name, digest] of Object.entries(binaries)) {
    const binary = join(directory, `${name}.xcframework/ios-arm64/${name}.framework/${name}`);
    if (!existsSync(binary) || sha256(readFileSync(binary)) !== digest) throw new Error(`Siprix ${name} binary checksum mismatch`);
  }
}

export async function stageSdk() {
  const temp = mkdtempSync(join(tmpdir(), "phone11-siprix-"));
  try {
    const response = await fetch(`https://codeload.github.com/siprix/SampleSwiftUI/tar.gz/${revision}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Siprix download failed: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== archiveSha256) throw new Error("Siprix archive checksum mismatch");
    const archive = join(temp, "sdk.tar.gz");
    writeFileSync(archive, data);
    execFileSync("tar", ["-xzf", archive, "-C", temp]);
    const sample = join(temp, `SampleSwiftUI-${revision}/SampleSwiftUI`);
    verifyBinaries(sample);
    rmSync(target, { recursive: true, force: true });
    for (const name of Object.keys(binaries)) cpSync(join(sample, `${name}.xcframework`), join(target, `${name}.xcframework`), { recursive: true });
    verifyBinaries(target);
    console.log(`Verified Siprix 1.0.40 trial frameworks (${revision}); trial calls limited to 60 seconds.`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stageSdk();
