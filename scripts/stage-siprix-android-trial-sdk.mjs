import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const trialProfile = "preview-android-siprix-foreground-trial";
export const maxAarBytes = 64 * 1024 * 1024;
export const sdkTimeoutMs = 120_000;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(projectRoot, "modules/phone11-siprix/android/sdk-lock.json"), "utf8"));
// Immutable official transport only. No caller-supplied URL, mirror or redirect.
if (lock.repository !== "https://github.com/siprix/SampleJava"
    || lock.revision !== "80d198ed6179b45ff8cd8dad9b8086976b4197a0"
    || lock.path !== "app/libs/siprix_voip_sdk.aar"
    || lock.sha256 !== "3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198") {
  throw new Error("E_ANDROID_TRIAL_SDK_LOCK");
}
export const sdkUrl = `https://raw.githubusercontent.com/siprix/SampleJava/${lock.revision}/${lock.path}`;
const requiredFlags = {
  EXPO_PUBLIC_SIP_ENGINE: "siprix",
  PHONE11_ANDROID_FOREGROUND_TRIAL: "1",
  EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL: "1",
  PHONE11_APP_STORE_BUILD: "0",
  PHONE11_VOIP_WAKE_COMMISSIONED: "0",
  PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED: "0",
  PHONE11_ANDROID_SCREEN_TRANSACTION: "0",
  EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION: "0",
  EXPO_PUBLIC_API_BASE_URL: "https://api.phone11.ai",
  EXPO_PUBLIC_DEEP_LINK_SCHEME: "phone11",
};
class StageFailure extends Error {}
const fail = code => { throw new StageFailure(code); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function requireTrialFlags(source) {
  if (Object.entries(requiredFlags).some(([key, value]) => source[key] !== value)) fail("E_ANDROID_TRIAL_FLAGS");
  if (source.PHONE11_SIPRIX_LICENSE?.trim()) fail("E_ANDROID_TRIAL_LICENSE");
}

export function cloudStageRequested(source) {
  if (source.EAS_BUILD_PROFILE !== trialProfile
      && (source.PHONE11_ANDROID_FOREGROUND_TRIAL ?? "0") === "0"
      && (source.EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL ?? "0") === "0") return false;
  if (source.EAS_BUILD_PROFILE !== trialProfile) fail("E_ANDROID_TRIAL_PROFILE");
  if (source.EAS_BUILD_PLATFORM !== "android") fail("E_ANDROID_TRIAL_PLATFORM");
  if (source.EAS_BUILD !== "true") fail("E_ANDROID_TRIAL_CLOUD_ONLY");
  requireTrialFlags(source);
  return true;
}

export function verifyTrialAar(filename) {
  if (!filename || !isAbsolute(filename)) fail("E_ANDROID_TRIAL_AAR_REQUIRED");
  let descriptor;
  try {
    if (!lstatSync(filename).isFile()) fail("E_ANDROID_TRIAL_AAR_REGULAR");
    descriptor = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > maxAarBytes) fail("E_ANDROID_TRIAL_AAR_SIZE");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let total = 0, count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) {
      total += count;
      if (total > maxAarBytes) fail("E_ANDROID_TRIAL_AAR_SIZE");
      hash.update(buffer.subarray(0, count));
    }
    if (hash.digest("hex") !== lock.sha256) fail("E_ANDROID_TRIAL_AAR_HASH");
    return lock.sha256;
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    fail("E_ANDROID_TRIAL_AAR_UNAVAILABLE");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export async function fetchPinnedAar(fetchImpl = globalThis.fetch, timeoutMs = sdkTimeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > sdkTimeoutMs) fail("E_ANDROID_TRIAL_TIMEOUT_BOUND");
  const controller = new AbortController();
  let timer, reader;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new StageFailure("E_ANDROID_TRIAL_TIMEOUT")); }, timeoutMs);
  });
  const receive = async () => {
    const response = await fetchImpl(sdkUrl, { redirect: "manual", signal: controller.signal,
      headers: { "Accept-Encoding": "identity" } });
    if (response.status >= 300 && response.status < 400) fail("E_ANDROID_TRIAL_REDIRECT");
    if (!response.ok || response.status !== 200 || (response.url && response.url !== sdkUrl)) fail("E_ANDROID_TRIAL_HTTP");
    if (![null, "identity"].includes(response.headers.get("content-encoding"))) fail("E_ANDROID_TRIAL_ENCODING");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > maxAarBytes)) fail("E_ANDROID_TRIAL_AAR_SIZE");
    if (!response.body) fail("E_ANDROID_TRIAL_EMPTY_BODY");
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxAarBytes) fail("E_ANDROID_TRIAL_AAR_SIZE");
      chunks.push(Buffer.from(value));
    }
    if (total < 1 || (length !== null && total !== Number(length))) fail("E_ANDROID_TRIAL_AAR_SIZE");
    const bytes = Buffer.concat(chunks, total);
    if (digest(bytes) !== lock.sha256) fail("E_ANDROID_TRIAL_AAR_HASH");
    return bytes;
  };
  try { return await Promise.race([receive(), deadline]); }
  catch (error) { if (error instanceof StageFailure) throw error; fail("E_ANDROID_TRIAL_TRANSPORT"); }
  finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation must not let an unresponsive transport extend the deadline.
    if (reader) void reader.cancel().catch(() => {});
  }
}

function writeAtomicAar(root, bytes) {
  if (digest(bytes) !== lock.sha256) fail("E_ANDROID_TRIAL_AAR_HASH");
  const realRoot = realpathSync(root);
  let directory = realRoot;
  for (const part of ["modules", "phone11-siprix", "vendor", "android"]) {
    directory = join(directory, part);
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    if (!lstatSync(directory).isDirectory()) fail("E_ANDROID_TRIAL_OUTPUT_DIRECTORY");
  }
  const target = join(directory, "siprix_voip_sdk.aar");
  const temporary = join(directory, `.siprix-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, target);
    verifyTrialAar(target);
    return target;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export async function stageAndroidTrialSdk({ source = process.env, root = projectRoot, fetchImpl = globalThis.fetch,
  persist = filename => execFileSync("set-env", ["PHONE11_SIPRIX_ANDROID_AAR", filename], { stdio: "ignore" }) } = {}) {
  if (!cloudStageRequested(source)) return { staged: false };
  let filename = source.PHONE11_SIPRIX_ANDROID_AAR;
  if (filename) verifyTrialAar(filename);
  else filename = writeAtomicAar(root, await fetchPinnedAar(fetchImpl));
  // set-env publishes only the verified absolute path to subsequent EAS phases.
  persist(filename);
  return { staged: true, sha256: lock.sha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await stageAndroidTrialSdk();
    if (result.staged) console.log("Staged pinned Android Siprix foreground trial SDK; 60-second calls.");
  } catch (error) {
    console.error(error instanceof StageFailure ? error.message : "E_ANDROID_TRIAL_STAGE");
    process.exitCode = 1;
  }
}
