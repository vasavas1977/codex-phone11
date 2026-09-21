import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import { getAuthSnapshot, getSessionToken } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";

const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const profilePhotoMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProfilePhotoUpload = {
  uri: string;
  mimeType: string;
  sizeBytes?: number | null;
  /** The browser picker supplies a File. Native upload uses the local URI. */
  file?: Blob;
};

export type ProfilePhotoDescriptor = {
  userId: number;
  photoUrl: string | null;
  photoVersion: string | null;
  mimeType?: string;
};

function requestError(status: number): Error {
  if (status === 401) return new Error("Sign in again to change your profile photo.");
  if (status === 403) return new Error("This workspace is unavailable for your account.");
  if (status === 413) return new Error("Choose a photo smaller than 5 MB.");
  if (status === 415) return new Error("Choose a JPEG, PNG, or WebP photo.");
  if (status === 400) return new Error("Choose a valid photo up to 4096 by 4096 pixels.");
  return new Error("Could not update your profile photo. Please try again.");
}

function validTenant(tenantId: number): boolean {
  return Number.isSafeInteger(tenantId) && tenantId > 0;
}

async function profilePhotoSession(tenantId: number) {
  const owner = getAuthSnapshot().user;
  const state = useChatStore.getState();
  if (!owner || getAuthSnapshot().loading)
    throw new Error("Sign in again to change your profile photo.");
  if (
    !validTenant(tenantId) ||
    state.userId !== owner.id ||
    state.workspace?.id !== tenantId
  )
    throw new Error("Select an active workspace first.");
  const token = Platform.OS === "web" ? null : await getSessionToken();
  if (Platform.OS !== "web" && !token)
    throw new Error("Sign in again to change your profile photo.");
  const assertCurrent = () => {
    const current = useChatStore.getState();
    if (
      getAuthSnapshot().user !== owner ||
      getAuthSnapshot().loading ||
      current.userId !== owner.id ||
      current.workspace?.id !== tenantId
    )
      throw new Error("Your account or workspace changed. Open Profile again.");
  };
  assertCurrent();
  return {
    owner,
    assertCurrent,
    headers: {
      "X-Phone11-Profile-Tenant": String(tenantId),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

function isSupportedMime(mimeType: string): boolean {
  return profilePhotoMimeTypes.has(mimeType.split(";", 1)[0]?.trim().toLowerCase());
}

function responseDescriptor(value: unknown): ProfilePhotoDescriptor {
  if (!value || typeof value !== "object") throw new Error("Phone11 returned an unexpected photo response.");
  const result = value as Record<string, unknown>;
  if (!Number.isSafeInteger(result.userId) || (result.userId as number) <= 0)
    throw new Error("Phone11 returned an unexpected photo response.");
  if (
    ![result.photoUrl, result.photoVersion].every(
      (entry) => entry === null || typeof entry === "string",
    )
  )
    throw new Error("Phone11 returned an unexpected photo response.");
  return {
    userId: result.userId as number,
    photoUrl: result.photoUrl as string | null,
    photoVersion: result.photoVersion as string | null,
    ...(typeof result.mimeType === "string" ? { mimeType: result.mimeType } : {}),
  };
}

export async function uploadWorkspaceProfilePhoto(
  tenantId: number,
  input: ProfilePhotoUpload,
): Promise<ProfilePhotoDescriptor> {
  if (!input.uri || !isSupportedMime(input.mimeType))
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  if (input.sizeBytes !== undefined && input.sizeBytes !== null && input.sizeBytes > MAX_PROFILE_PHOTO_BYTES)
    throw new Error("Choose a photo smaller than 5 MB.");
  const session = await profilePhotoSession(tenantId);
  const url = `${getApiBaseUrl()}/api/profile/photo`;
  let response: Response;
  if (Platform.OS === "web") {
    const body = input.file ?? (await (await fetch(input.uri)).blob());
    if (body.size > MAX_PROFILE_PHOTO_BYTES)
      throw new Error("Choose a photo smaller than 5 MB.");
    session.assertCurrent();
    response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { ...session.headers, "Content-Type": input.mimeType },
      body,
    });
  } else {
    const files = await import("expo-file-system/legacy");
    session.assertCurrent();
    const result = await files.uploadAsync(url, input.uri, {
      httpMethod: "POST",
      uploadType: files.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...session.headers, "Content-Type": input.mimeType },
      sessionType: files.FileSystemSessionType.FOREGROUND,
    });
    session.assertCurrent();
    if (result.status < 200 || result.status >= 300) throw requestError(result.status);
    try {
      return responseDescriptor(JSON.parse(result.body));
    } catch {
      throw new Error("Phone11 returned an unexpected photo response.");
    }
  }
  session.assertCurrent();
  if (!response.ok) throw requestError(response.status);
  return responseDescriptor(await response.json().catch(() => null));
}

export async function removeWorkspaceProfilePhoto(
  tenantId: number,
): Promise<ProfilePhotoDescriptor> {
  const session = await profilePhotoSession(tenantId);
  const response = await fetch(
    `${getApiBaseUrl()}/api/profile/photo/${encodeURIComponent(String(tenantId))}`,
    {
      method: "DELETE",
      credentials: Platform.OS === "web" ? "include" : "omit",
      headers: session.headers,
    },
  );
  session.assertCurrent();
  if (!response.ok) throw requestError(response.status);
  return responseDescriptor(await response.json().catch(() => null));
}

export { MAX_PROFILE_PHOTO_BYTES, isSupportedMime };
