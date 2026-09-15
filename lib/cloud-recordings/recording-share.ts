import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";
import { playbackURL } from "./presentation";

interface RecordingShareResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RecordingShareDependencies {
  identity(): object | null;
  token(): Promise<string | null>;
  request(
    url: string,
    init: { credentials: "include" | "omit"; headers?: Record<string, string> },
  ): Promise<RecordingShareResponse>;
  saveNative(
    bytes: Uint8Array,
    filename: string,
    mimeType: string,
  ): Promise<void>;
  saveWeb(bytes: Uint8Array, filename: string, mimeType: string): Promise<void>;
}

interface TemporaryShareFile {
  readonly uri: string;
  readonly exists: boolean;
  create(options: { overwrite: boolean }): void;
  write(bytes: Uint8Array): void;
  delete(): void;
}

export interface NativeRecordingShareRuntime {
  available(): Promise<boolean>;
  createFile(filename: string): TemporaryShareFile;
  share(
    uri: string,
    options: { dialogTitle: string; mimeType: string; UTI: string },
  ): Promise<void>;
}

const recordingFilename = (callUuid: string, mimeType: string) =>
  `Phone11-${callUuid}.${mimeType.includes("mpeg") ? "mp3" : "wav"}`;

async function nativeRecordingShareRuntime(): Promise<NativeRecordingShareRuntime> {
  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);
  return {
    available: Sharing.isAvailableAsync,
    createFile: (filename) => new File(Paths.cache, filename),
    share: Sharing.shareAsync,
  };
}

export async function saveNativeRecording(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  runtime?: NativeRecordingShareRuntime,
) {
  const sharing = runtime ?? (await nativeRecordingShareRuntime());
  if (!(await sharing.available()))
    throw new Error("Sharing is unavailable on this device.");
  const file = sharing.createFile(filename);
  try {
    file.create({ overwrite: true });
    file.write(bytes);
    await sharing.share(file.uri, {
      dialogTitle: "Share recording",
      mimeType,
      UTI: mimeType.includes("mpeg")
        ? "public.mp3"
        : "com.microsoft.waveform-audio",
    });
  } finally {
    if (file.exists) file.delete();
  }
}

async function saveWebRecording(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
) {
  if (typeof document === "undefined" || typeof URL === "undefined")
    throw new Error("Saving is unavailable in this preview.");
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const defaultDependencies: RecordingShareDependencies = {
  identity: () => Auth.getAuthSnapshot().user,
  token: () => Auth.getSessionToken(),
  request: (url, init) => fetch(url, init),
  saveNative: saveNativeRecording,
  saveWeb: saveWebRecording,
};

/** Downloads the exact authenticated recording and shares only a temporary
 * local copy. The bearer never enters a URL or persistent storage. */
export async function shareAuthenticatedRecording(
  options: {
    callUuid: string;
    path: string;
    platform: string;
    base?: string;
    canShare?(): boolean;
  },
  dependencies: RecordingShareDependencies = defaultDependencies,
) {
  const identity = dependencies.identity();
  const url = playbackURL(
    options.base ?? getApiBaseUrl(),
    options.callUuid,
    options.path,
  );
  if (!identity || !url || options.canShare?.() === false)
    throw new Error("Recording is unavailable.");

  const native = options.platform !== "web";
  const token = native ? await dependencies.token() : null;
  if (
    dependencies.identity() !== identity ||
    options.canShare?.() === false ||
    (native && !token)
  )
    throw new Error("Your session changed. Please try again.");

  const response = await dependencies.request(url, {
    credentials: native ? "omit" : "include",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Please sign in again."
        : "Recording could not be downloaded.",
    );

  const mimeType =
    response.headers.get("content-type")?.split(";")[0].trim() || "audio/wav";
  if (!mimeType.startsWith("audio/"))
    throw new Error("The downloaded recording was invalid.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    dependencies.identity() !== identity ||
    options.canShare?.() === false ||
    (native && (await dependencies.token()) !== token)
  )
    throw new Error("Your session changed. Please try again.");
  if (!bytes.byteLength) throw new Error("The downloaded recording was empty.");

  const filename = recordingFilename(options.callUuid, mimeType);
  if (native) await dependencies.saveNative(bytes, filename, mimeType);
  else await dependencies.saveWeb(bytes, filename, mimeType);
}
