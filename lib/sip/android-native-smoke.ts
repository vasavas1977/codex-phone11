const pinnedVersion = /^(?:Siprix: ?|siprix )?1\.1\.0 from 20260905_1222$/;

const nativeFailures = {
  E_SMOKE_STATE: "The SDK must be idle and fully released before this isolated check can run.",
  E_SDK_VERSION: "The native SDK version does not match the pinned Android build.",
  E_ANDROID_SOURCE_GATE: "The installed build has not enabled this native SDK check.",
  E_ANDROID_FOREGROUND_REQUIRED: "Keep Phone11 open in the foreground during this check.",
  E_ANDROID_SDK_RUNTIME: "The pinned Android SDK runtime is unavailable.",
  E_STALE_BRIDGE: "The phone session changed. Reopen diagnostics before checking again.",
  E_CLEANUP_REQUIRED: "The native SDK requires cleanup before another check.",
  E_NATIVE_WAKE_OWNED: "A native incoming call currently owns the SDK.",
  E_INVALID_ARGUMENT: "The native bridge rejected the current SDK state.",
  E_UNSUPPORTED: "This installed build does not support the native SDK check.",
} as const;

type SmokeResult = { ok: true; sdkVersion: string } | { ok: false; code: string; detail: string };

function nativeFailure(error: unknown): SmokeResult {
  // Never copy arbitrary bridge messages, configuration or unknown error codes.
  try {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(nativeFailures, code)) {
      return { ok: false, code, detail: nativeFailures[code as keyof typeof nativeFailures] };
    }
    // The adapter's SDK status is a Java int. Regenerate only canonical bounded
    // numeric statuses; no arbitrary suffix or vendor exception text is copied.
    if (typeof code === "string" && /^E_SIPRIX_-?[1-9]\d{0,9}$/.test(code)) {
      const status = Number(code.slice("E_SIPRIX_".length));
      if (Number.isInteger(status) && status >= -2147483648 && status <= 2147483647) {
        return { ok: false, code: `E_SIPRIX_${status}`, detail: "The native SDK rejected initialization or release." };
      }
    }
  } catch { /* Untrusted error accessors are not diagnostic evidence. */ }
  return { ok: false, code: "E_NATIVE_SMOKE_REJECTED", detail: "The native bridge rejected the SDK check." };
}

/** A receipt proves only initialization and release without accounts or calls. */
export async function checkAndroidNativeSdkSmoke(run?: () => Promise<unknown>): Promise<SmokeResult> {
  if (!run) return { ok: false, code: "E_NATIVE_SMOKE_UNAVAILABLE", detail: "The native SDK check is unavailable in this build." };
  let value: unknown;
  try { value = await run(); }
  catch (error) { return nativeFailure(error); }
  try {
    const receipt = value as Record<string, unknown> | null;
    if (receipt?.initialized === false && receipt.registrationAttempted === false && receipt.callAttempted === false &&
        Array.isArray(receipt.accounts) && receipt.accounts.length === 0 &&
        Array.isArray(receipt.calls) && receipt.calls.length === 0 &&
        typeof receipt.sdkVersion === "string" && receipt.sdkVersion.length <= 80 && pinnedVersion.test(receipt.sdkVersion.trim())) {
      return { ok: true, sdkVersion: receipt.sdkVersion.trim() };
    }
  } catch { /* A malformed receipt cannot prove a clean release. */ }
  return { ok: false, code: "E_NATIVE_SMOKE_RECEIPT", detail: "The native SDK check returned an invalid release receipt." };
}
