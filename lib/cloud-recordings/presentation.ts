export const recordingLabels = {
  off: "Recording off",
  pending: "Recording pending",
  recording: "Recording in progress",
  ready: "Play recording",
  failed: "Recording unavailable",
} as const;
export const summaryLabels = {
  off: "AI summary off",
  queued: "AI summary queued",
  processing: "AI summary processing",
  ready: "AI summary ready",
  failed: "AI summary unavailable",
} as const;
export function playbackURL(
  base: string,
  callUuid: string,
  path?: string,
): string | null {
  if (
    !/^[a-f0-9-]{36}$/i.test(callUuid) ||
    path !== `/api/recordings/play/${callUuid}`
  )
    return null;
  try {
    const origin = new URL(base);
    if (origin.protocol !== "https:") return null;
    return new URL(path, origin.origin).href;
  } catch {
    return null;
  }
}

/** Build only the authenticated, tenant-checked voicemail playback route. */
export function voicemailPlaybackURL(
  base: string,
  voicemailId: number,
  path?: string,
): string | null {
  if (
    !Number.isSafeInteger(voicemailId) ||
    voicemailId <= 0 ||
    path !== `/api/recordings/voicemail/${voicemailId}`
  )
    return null;
  try {
    const origin = new URL(base);
    if (origin.protocol !== "https:") return null;
    return new URL(path, origin.origin).href;
  } catch {
    return null;
  }
}
