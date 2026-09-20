import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import { getAuthSnapshot, getSessionToken } from "@/lib/_core/auth";
import type { ChatAttachment } from "./types";
import { useChatStore } from "./store";

export interface ChatUpload {
  uri: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  file?: Blob;
}
const MAX_CHAT_MEDIA_BYTES = 10 * 1024 * 1024;
export const newUploadId = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
function uploadSignal(cancel?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    const error = new Error("The upload timed out. Check your connection and retry.");
    error.name = "TimeoutError";
    controller.abort(error);
  }, 60_000);
  const onCancel = () => controller.abort(cancel?.reason);
  cancel?.addEventListener("abort", onCancel, { once: true });
  if (cancel?.aborted) onCancel();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      cancel?.removeEventListener("abort", onCancel);
    },
  };
}
function waitForUpload<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    void task.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}
export async function chatMediaSession() {
  const owner = getAuthSnapshot().user;
  if (!owner || getAuthSnapshot().loading)
    throw new Error("Sign in again to use attachments.");
  const tenantId = useChatStore.getState().workspace?.id;
  if (
    typeof tenantId !== "number" ||
    !Number.isSafeInteger(tenantId) ||
    tenantId <= 0 ||
    useChatStore.getState().userId !== owner.id
  )
    throw new Error("Open the conversation workspace again.");
  const assertOwner = () => {
    if (
      getAuthSnapshot().user !== owner ||
      getAuthSnapshot().loading ||
      useChatStore.getState().userId !== owner.id ||
      useChatStore.getState().workspace?.id !== tenantId
    )
      throw new Error(
        "Your account or workspace changed. Open the conversation again.",
      );
  };
  const token = Platform.OS === "web" ? null : await getSessionToken();
  assertOwner();
  if (Platform.OS !== "web" && !token)
    throw new Error("Sign in again to use attachments.");
  const headers: Record<string, string> = {
    "X-Phone11-Chat-Owner": String(owner.id),
    "X-Phone11-Chat-Tenant": String(tenantId),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return { headers, assertOwner, tenantId };
}
export async function uploadChatMedia(
  tenantId: number,
  conversationId: string,
  input: ChatUpload,
  clientId: string,
  signal?: AbortSignal,
): Promise<ChatAttachment> {
  if (signal?.aborted) throw signal.reason;
  if (input.sizeBytes && input.sizeBytes > 10 * 1024 * 1024)
    throw new Error("Choose a file smaller than 10 MB.");
  const session = await chatMediaSession();
  if (session.tenantId !== tenantId)
    throw new Error("Your workspace changed. Open the conversation again.");
  const headers = {
    ...session.headers,
    "Content-Type": input.mimeType,
    "X-Phone11-Chat-Tenant": String(tenantId),
    "X-Phone11-Chat-Conversation": conversationId,
    "X-Phone11-Chat-Client-Id": clientId,
    "X-Phone11-Chat-Filename": encodeURIComponent(input.filename),
  };
  const url = `${getApiBaseUrl()}/api/chat/media/upload`;
  const request = uploadSignal(signal);
  let status: number, data: any;
  try {
    if (Platform.OS === "web") {
      const body = input.file || (await (await fetch(input.uri)).blob());
      session.assertOwner();
      const result = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body,
        signal: request.signal,
      });
      status = result.status;
      data = await result.json().catch(() => null);
    } else {
      const files = await import("expo-file-system/legacy");
      session.assertOwner();
      const result = await waitForUpload(files.uploadAsync(url, input.uri, {
        httpMethod: "POST",
        uploadType: files.FileSystemUploadType.BINARY_CONTENT,
        headers,
        sessionType: files.FileSystemSessionType.FOREGROUND,
      }), request.signal);
      status = result.status;
      try {
        data = JSON.parse(result.body);
      } catch {
        data = null;
      }
    }
  } finally {
    request.dispose();
  }
  if (signal?.aborted) throw signal.reason;
  session.assertOwner();
  if (status < 200 || status >= 300)
    throw new Error(
      status === 413
        ? "Choose a file smaller than 10 MB."
        : status === 415
          ? "This file type is not supported."
          : status === 503
            ? "File sharing is temporarily unavailable. Please try again later."
            : "The file could not be uploaded. Check your connection and retry.",
    );
  return data.attachment || data;
}
export async function getChatMediaSource(
  id: string,
  expected?: Pick<ChatAttachment, "filename" | "sizeBytes">,
  signal?: AbortSignal,
) {
  if (
    expected &&
    (!Number.isSafeInteger(expected.sizeBytes) ||
      expected.sizeBytes <= 0 ||
      expected.sizeBytes > MAX_CHAT_MEDIA_BYTES)
  )
    throw new Error("Attachment is unavailable.");
  const session = await chatMediaSession();
  const uri = `${getApiBaseUrl()}/api/chat/media/${encodeURIComponent(id)}`;
  if (Platform.OS !== "web") {
    const files = await import("expo-file-system/legacy");
    const safeName = (expected?.filename || "media.bin").replace(
      /[^\p{L}\p{N}._-]/gu,
      "_",
    );
    const path = `${files.cacheDirectory}chat-play-${id}-${newUploadId()}-${safeName}`;
    const remove = () => {
      void files.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    };
    const request = new AbortController();
    const timeout = setTimeout(() => {
      const error = new Error(
        "The attachment timed out. Check your connection and retry.",
      );
      error.name = "TimeoutError";
      request.abort(error);
    }, 30_000);
    const cancel = () => request.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let tooLarge = false;
    let discard = false;
    const transfer = files.createDownloadResumable(
      uri,
      path,
      {
        headers: session.headers,
        sessionType: files.FileSystemSessionType.FOREGROUND,
      },
      ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
        if (
          totalBytesWritten > MAX_CHAT_MEDIA_BYTES ||
          totalBytesExpectedToWrite > MAX_CHAT_MEDIA_BYTES
        ) {
          tooLarge = true;
          request.abort(new Error("Attachment is unavailable."));
        }
      },
    );
    const onAbort = () => {
      discard = true;
      void transfer.cancelAsync().catch(() => undefined).finally(remove);
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    const download = request.signal.aborted
      ? Promise.reject<undefined>(request.signal.reason)
      : transfer.downloadAsync();
    // Native cancellation is asynchronous. If it loses a race with completion,
    // remove the completed file after this call has already rejected.
    void download.then(
      () => {
        if (discard) remove();
      },
      () => {
        if (discard) remove();
      },
    );
    try {
      const result = await waitForUpload(download, request.signal);
      session.assertOwner();
      if (!result || result.status !== 200 || tooLarge)
        throw new Error("Attachment is unavailable.");
      const info = await files.getInfoAsync(path);
      if (request.signal.aborted) throw request.signal.reason;
      session.assertOwner();
      if (
        !info.exists ||
        info.isDirectory ||
        info.size <= 0 ||
        info.size > MAX_CHAT_MEDIA_BYTES ||
        (expected && info.size !== expected.sizeBytes)
      )
        throw new Error("Attachment is unavailable.");
      return {
        // AVFoundation requires byte-range support for remote media. The
        // authenticated chat endpoint intentionally returns a bounded whole
        // object, so hand the player a verified local file instead.
        source: { uri: result.uri },
        release: remove,
        assertOwner: session.assertOwner,
      };
    } catch (error) {
      discard = true;
      remove();
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      request.signal.removeEventListener("abort", onAbort);
    }
  }
  const response = await fetch(uri, {
    credentials: "include",
    headers: session.headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Attachment is unavailable.");
  const blob = await response.blob();
  session.assertOwner();
  if (
    blob.size <= 0 ||
    blob.size > MAX_CHAT_MEDIA_BYTES ||
    (expected && blob.size !== expected.sizeBytes)
  )
    throw new Error("Attachment is unavailable.");
  const objectUrl = URL.createObjectURL(blob);
  return {
    source: { uri: objectUrl },
    release: () => URL.revokeObjectURL(objectUrl),
    assertOwner: session.assertOwner,
  };
}
export async function shareChatFile(attachment: ChatAttachment) {
  const session = await chatMediaSession();
  const url = `${getApiBaseUrl()}/api/chat/media/${encodeURIComponent(attachment.id)}`;
  if (Platform.OS === "web") {
    const media = await getChatMediaSource(attachment.id, attachment);
    try {
      session.assertOwner();
      media.assertOwner();
      const link = document.createElement("a");
      link.href = media.source.uri;
      link.download = attachment.filename;
      link.click();
    } finally {
      setTimeout(media.release, 1000);
    }
    return;
  }
  const files = await import("expo-file-system/legacy");
  const sharing = await import("expo-sharing");
  const safeName = attachment.filename.replace(/[^\p{L}\p{N}._-]/gu, "_");
  const path = `${files.cacheDirectory}chat-${attachment.id}-${safeName}`;
  try {
    const result = await files.downloadAsync(url, path, {
      headers: session.headers,
    });
    session.assertOwner();
    if (result.status !== 200) throw new Error("Attachment is unavailable.");
    await sharing.shareAsync(path, { mimeType: attachment.mimeType });
  } finally {
    await files.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}
