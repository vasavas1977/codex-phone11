/** Inert private-binding library. No listener, worker, signal or CLI startup. */
import path from "node:path";
import { configureOwnedPbxPool, getPool, closeOwnedPbxPool, withTransaction, type OwnedPbxPoolBinding } from "phone11-maintained/db";
import { getPhone11Auth, readAuthConfig } from "phone11-maintained/auth";

export interface PrivateRetainedBinding {
  database: OwnedPbxPoolBinding;
  auth: { baseURL: string; secret: string; trustedOrigins: string[] };
  recordingsPath: string;
  chatMediaPath: string;
}
let setupAttempted = false;
let closed = false;

function requiredPath(value: string): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || value === "/" || !path.isAbsolute(value) || path.normalize(value) !== value) throw new Error();
  return value;
}

/**
 * One private setup attempt per bundled module graph. Imports that capture
 * storage environment are deliberately deferred until after this binding.
 * Actual role/ACL/schema/TLS attestation BEFORE listen is still required.
 */
export async function createBoundRetainedRuntime(binding: PrivateRetainedBinding) {
  if (setupAttempted) throw new Error("RETAINED_BOUND_SETUP_REFUSED");
  setupAttempted = true;
  let poolBound = false;
  try {
    if (!binding || !binding.auth || typeof binding.auth.baseURL !== "string" || !binding.auth.baseURL
      || typeof binding.auth.secret !== "string" || binding.auth.secret.length > 4096 || binding.auth.secret.includes("\0")
      || !Array.isArray(binding.auth.trustedOrigins) || binding.auth.trustedOrigins.length > 16
      || binding.auth.trustedOrigins.some(value => typeof value !== "string" || value.length > 2048)) throw new Error();
    const selected = {
      PHONE11_AUTH_BASE_URL: binding.auth.baseURL,
      PHONE11_AUTH_SECRET: binding.auth.secret,
      PHONE11_AUTH_TRUSTED_ORIGINS: binding.auth.trustedOrigins.join(","),
      RECORDINGS_PATH: requiredPath(binding.recordingsPath),
      PHONE11_CHAT_MEDIA_PATH: requiredPath(binding.chatMediaPath),
    };
    // Reuse maintained validation with explicit values, never its default env.
    readAuthConfig({ ...selected, NODE_ENV: "production" });
    if (Object.entries(selected).some(([key, value]) => process.env[key] !== undefined && process.env[key] !== value)) throw new Error();
    const excludedMailer = ["PHONE11_PASSWORD_RESET_PROVIDER", "PHONE11_PASSWORD_RESET_RESEND_API_KEY", "PHONE11_PASSWORD_RESET_FROM"];
    if (excludedMailer.some(key => Boolean(process.env[key]))) throw new Error();
    configureOwnedPbxPool(binding.database);
    poolBound = true;
    for (const [key, value] of Object.entries(selected)) process.env[key] = value;
    const available = () => !closed && Object.entries(selected).every(([key, value]) => process.env[key] === value)
      && excludedMailer.every(key => !process.env[key]);
    // Both imports resolve to the SAME statically pinned graph. Importing the
    // maintained wake service constructs no provider session or background job.
    const [{ createRetainedRuntimeCandidate }, { wakeService }] = await Promise.all([
      import("./composition"), import("phone11-maintained/wake-service"),
    ]);
    if (!available()) throw new Error();
    const close = () => { closed = true; return closeOwnedPbxPool(); };
    const composed = createRetainedRuntimeCandidate({
      admissionAvailable: available,
      auth: { getAuth: getPhone11Auth, getDatabase: getPool },
      wake: wakeService,
      chatTransaction: withTransaction,
      closeResources: close,
    });
    return Object.freeze({ app: composed.app, plan: composed.plan, close, createShutdown: composed.createShutdown });
  } catch {
    closed = true;
    // Never retry setup or restore environment after modules may have captured
    // it. A failed pool close is retained as unknown cleanup, never swallowed.
    if (poolBound) {
      try { await closeOwnedPbxPool(); }
      catch { throw new Error("RETAINED_BOUND_SETUP_CLEANUP_UNCONFIRMED"); }
    }
    throw new Error("RETAINED_BOUND_SETUP_REFUSED");
  }
}
