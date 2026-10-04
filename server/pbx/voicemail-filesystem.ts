import * as fs from "node:fs";
import * as path from "node:path";

/** Persist every directory link up to the pre-provisioned media root. */
export async function syncVoicemailDirectories(directory: string, base: string): Promise<void> {
  if (directory !== base && !directory.startsWith(base + path.sep))
    throw new Error("Invalid voicemail directory");
  for (let current = directory; ; current = path.dirname(current)) {
    const handle = await fs.promises.open(current, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    if (current === base) return;
  }
}

/**
 * Exercise the publication/replay primitives in one private scratch directory.
 * This is point-in-time filesystem support, not mount survival or PBX delivery.
 * Never inspect, repair, or sweep existing media or another probe's artifacts.
 */
export async function probeVoicemailFilesystem(directory: string): Promise<boolean> {
  let base: string | undefined;
  let scratch: string | undefined;
  let source: string | undefined;
  let published: string | undefined;
  let ready = false;
  let cleanupOk = true;
  try {
    if (!(await fs.promises.lstat(directory)).isDirectory()) return false;
    base = await fs.promises.realpath(directory);
    scratch = await fs.promises.mkdtemp(path.join(base, ".phone11-voicemail-probe-"));
    const sourcePath = path.join(scratch, "pending");
    const publishedPath = path.join(scratch, "published");
    const bytes = Buffer.from("phone11 voicemail filesystem probe");
    const staging = await fs.promises.open(sourcePath, "wx", 0o600);
    source = sourcePath;
    try {
      await staging.writeFile(bytes);
      await staging.sync();
    } finally { await staging.close(); }
    await fs.promises.link(sourcePath, publishedPath);
    published = publishedPath;
    // Require the same exclusive, no-overwrite publication used by deposits.
    try {
      await fs.promises.link(sourcePath, publishedPath);
      throw new Error("Voicemail publication did not remain exclusive");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const replay = await fs.promises.open(publishedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = await replay.stat();
      if (!stat.isFile() || stat.size !== bytes.length || !(await replay.readFile()).equals(bytes))
        throw new Error("Voicemail probe identity mismatch");
      await replay.sync();
    } finally { await replay.close(); }
    await syncVoicemailDirectories(scratch, base);
    ready = true;
  } catch { /* Missing or unsupported primitives fail closed without exposing paths. */ }
  finally {
    // Only names successfully created by this invocation belong to the probe.
    // A failed cleanup retains private evidence; no recursive removal/sweeping.
    for (const file of [published, source]) {
      if (!file) continue;
      try { await fs.promises.unlink(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupOk = false; }
    }
    if (scratch && base) {
      try { await fs.promises.rmdir(scratch); } catch { cleanupOk = false; }
      try { await syncVoicemailDirectories(base, base); } catch { cleanupOk = false; }
    }
  }
  return ready && cleanupOk;
}
