const fs = require("node:fs");
const path = require("node:path");

const candidatePackage = "ai.phone11.mobile.androidcandidate";
const wakePackage = "ai.phone11.mobile.staging";
function flag(source, name) {
  const value = source[name] ?? "0";
  if (!["0", "1"].includes(value)) throw new Error(`Invalid ${name} flag`);
  return value === "1";
}

function androidCandidateSettings(source = process.env) {
  const enabled = flag(source, "PHONE11_ANDROID_NATIVE_CANDIDATE");
  if (enabled !== flag(source, "EXPO_PUBLIC_PHONE11_ANDROID_NATIVE_CANDIDATE")) {
    throw new Error("Android native candidate requires matching native and JavaScript flags");
  }
  const chat = flag(source, "PHONE11_ANDROID_CHAT_NOTIFICATIONS");
  const wake = flag(source, "PHONE11_ANDROID_WAKE_CANDIDATE");
  if (wake !== flag(source, "EXPO_PUBLIC_PHONE11_ANDROID_WAKE_CANDIDATE")) throw new Error("Android wake candidate requires matching native and JavaScript flags");
  if (enabled && (source.PHONE11_ANDROID_FOREGROUND_TRIAL !== "1" ||
      source.EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL !== "1" ||
      source.EXPO_PUBLIC_SIP_ENGINE !== "siprix" || source.EAS_BUILD_PLATFORM === "ios" ||
      source.PHONE11_APP_STORE_BUILD === "1" || source.PHONE11_VOIP_WAKE_COMMISSIONED === "1" ||
      source.PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED === "1")) {
    throw new Error("Android native candidate requires the isolated Android Siprix configuration");
  }
  if ((chat || wake) && !enabled) throw new Error("Android notifications require the native candidate");
  const packageName = wake ? wakePackage : candidatePackage;
  let googleServicesFile, projectId, wakeOrigin;
  if (wake) {
    const value = source.EXPO_PUBLIC_API_BASE_URL;
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error("Android wake requires a fixed HTTPS API origin"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
        parsed.pathname !== "/" || value !== parsed.origin) throw new Error("Android wake requires a fixed HTTPS API origin");
    wakeOrigin = parsed.origin;
  }
  if (chat || wake) {
    googleServicesFile = source.PHONE11_ANDROID_GOOGLE_SERVICES_FILE;
    if (!googleServicesFile || !path.isAbsolute(googleServicesFile)) {
      throw new Error("Android notifications require an absolute matching Google services configuration path");
    }
    const config = JSON.parse(fs.readFileSync(googleServicesFile, "utf8"));
    projectId = config.project_info?.project_id;
    if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
        projectId !== source.PHONE11_ANDROID_FCM_PROJECT_ID ||
        !config.client?.some(client => client.client_info?.android_client_info?.package_name === packageName)) {
      throw new Error("Android Firebase project and package must match the candidate configuration");
    }
  }
  return { enabled, chat, wake, packageName, googleServicesFile, projectId, wakeOrigin };
}
module.exports = { androidCandidateSettings, candidatePackage, wakePackage };
