import "dotenv/config";
import { getPool } from "../server/pbx/db";
import { maintainProfilePhotoStorage, profilePhotoStorageReady } from "../server/profile/photo";
import {
  acquireProfilePhotoCleanupLease,
  PROFILE_PHOTO_CLEANUP_INTERVAL_DEFAULT_MS,
  startProfilePhotoCleanupWorker,
} from "../server/profile/photo-cleanup-worker";

function intervalFromEnvironment(): number {
  const configured = process.env.PHONE11_PROFILE_PHOTO_CLEANUP_INTERVAL_MS;
  if (configured === undefined) return PROFILE_PHOTO_CLEANUP_INTERVAL_DEFAULT_MS;
  if (!/^[1-9][0-9]*$/.test(configured)) throw new Error("Invalid profile photo cleanup interval configuration");
  const interval = Number(configured);
  if (!Number.isSafeInteger(interval)) throw new Error("Invalid profile photo cleanup interval configuration");
  return interval;
}

async function main(): Promise<void> {
  if (process.env.PHONE11_PROFILE_PHOTO_WORKER !== "1") {
    throw new Error("Set PHONE11_PROFILE_PHOTO_WORKER=1 to run the dedicated profile photo worker");
  }
  if (!process.env.PHONE11_CHAT_MEDIA_PATH) throw new Error("PHONE11_CHAT_MEDIA_PATH is required");
  if (!(await profilePhotoStorageReady())) throw new Error("Configured profile photo storage is unavailable");

  const pool = getPool();
  const worker = await startProfilePhotoCleanupWorker({
    intervalMs: intervalFromEnvironment(),
    acquireLease: async () => acquireProfilePhotoCleanupLease(await pool.connect()),
    maintain: maintainProfilePhotoStorage,
    log(event, details) {
      if (event === "cycle-complete") {
        console.info(JSON.stringify({ worker: "profile-photo-cleanup", event, deleted: details.deleted ?? 0, at: new Date().toISOString() }));
      } else {
        console.error(JSON.stringify({ worker: "profile-photo-cleanup", event, code: details.code ?? "UNKNOWN", at: new Date().toISOString() }));
      }
    },
    onFatal() {
      process.exitCode = 1;
      void pool.end().catch(() => { process.exitCode = 1; });
    },
  });

  let stopping: Promise<void> | undefined;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    console.info(JSON.stringify({ worker: "profile-photo-cleanup", event: "stopping", signal, at: new Date().toISOString() }));
    stopping = worker.stop()
      .then(() => pool.end())
      .then(() => { process.exitCode = 0; })
      .catch(() => {
        console.error(JSON.stringify({ worker: "profile-photo-cleanup", event: "shutdown-failed" }));
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.info(JSON.stringify({ worker: "profile-photo-cleanup", event: "started", intervalMs: intervalFromEnvironment() }));
}

main().catch(error => {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(JSON.stringify({ worker: "profile-photo-cleanup", event: "startup-failed", code: typeof code === "string" ? code : "CONFIG_OR_LEASE" }));
  process.exitCode = 1;
});
