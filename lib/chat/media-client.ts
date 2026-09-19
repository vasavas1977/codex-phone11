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
export const newUploadId = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
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
): Promise<ChatAttachment> {
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
  let status: number, data: any;
  if (Platform.OS === "web") {
    const body = input.file || (await (await fetch(input.uri)).blob());
    session.assertOwner();
    const result = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      body,
      signal: AbortSignal.timeout(60000),
    });
    status = result.status;
    data = await result.json().catch(() => null);
  } else {
    const files = await import("expo-file-system/legacy");
    session.assertOwner();
    const result = await files.uploadAsync(url, input.uri, {
      httpMethod: "POST",
      uploadType: files.FileSystemUploadType.BINARY_CONTENT,
      headers,
      sessionType: files.FileSystemSessionType.FOREGROUND,
    });
    status = result.status;
    try {
      data = JSON.parse(result.body);
    } catch {
      data = null;
    }
  }
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
export async function getChatMediaSource(id: string) {
  const session = await chatMediaSession();
  const uri = `${getApiBaseUrl()}/api/chat/media/${encodeURIComponent(id)}`;
  if (Platform.OS !== "web")
    return {
      source: { uri, headers: session.headers },
      release: () => {},
      assertOwner: session.assertOwner,
    };
  const response = await fetch(uri, {
    credentials: "include",
    headers: session.headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Attachment is unavailable.");
  const blob = await response.blob();
  session.assertOwner();
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
    const media = await getChatMediaSource(attachment.id);
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
