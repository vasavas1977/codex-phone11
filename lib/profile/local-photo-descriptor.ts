import AsyncStorage from "@react-native-async-storage/async-storage";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";
import type { ProfilePhotoDescriptor } from "./photo-client";

const prefix = "phone11.profile.photo.v1:user:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerOperations = new Map<number, Promise<void>>();
export type StoredPhotoDescriptor = { descriptor: ProfilePhotoDescriptor; savedAt: number };
type PhotoListener = (ownerId: number, tenantId: number, stored: StoredPhotoDescriptor) => void;
const confirmedPhotos = new Map<string, StoredPhotoDescriptor>();
const photoListeners = new Set<PhotoListener>();

function enqueueOwnerOperation(ownerId: number, operation: () => Promise<void>): Promise<void> {
  const pending = (ownerOperations.get(ownerId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  ownerOperations.set(ownerId, pending);
  void pending.finally(() => { if (ownerOperations.get(ownerId) === pending) ownerOperations.delete(ownerId); }).catch(() => undefined);
  return pending;
}

function storageKey(ownerId: number, tenantId: number): string {
  return `${prefix}${ownerId}:tenant:${tenantId}`;
}

export function getConfirmedPhotoDescriptor(ownerId: number, tenantId: number): StoredPhotoDescriptor | null {
  if (getAuthSnapshot().user?.id !== ownerId) return null;
  return confirmedPhotos.get(storageKey(ownerId, tenantId)) ?? null;
}

export function subscribeConfirmedPhotoDescriptor(listener: PhotoListener): () => void {
  photoListeners.add(listener);
  return () => { photoListeners.delete(listener); };
}

/** Broadcast only a server-confirmed result; persistence is best effort. */
export function confirmPhotoDescriptor(
  ownerId: number, tenantId: number, descriptor: ProfilePhotoDescriptor, savedAt = Date.now(),
): StoredPhotoDescriptor {
  if (!validLocalPhotoDescriptor(descriptor, ownerId, tenantId))
    throw new Error("Phone11 returned an unexpected photo response.");
  if (!Number.isSafeInteger(savedAt) || savedAt <= 0) throw new Error("Invalid profile photo timestamp.");
  if (getAuthSnapshot().user?.id !== ownerId) throw new Error("Select an active workspace first.");
  const stored = { descriptor, savedAt };
  confirmedPhotos.set(storageKey(ownerId, tenantId), stored);
  photoListeners.forEach((listener) => listener(ownerId, tenantId, stored));
  return stored;
}

/** The cached value is only a private, server-issued pointer; the image still requires auth. */
export function validLocalPhotoDescriptor(
  value: unknown,
  ownerId: number,
  tenantId: number,
): value is ProfilePhotoDescriptor {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || !Number.isSafeInteger(tenantId) || tenantId <= 0)
    return false;
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Record<string, unknown>;
  if (descriptor.userId !== ownerId) return false;
  if (descriptor.photoUrl === null && descriptor.photoVersion === null) return true;
  if (typeof descriptor.photoUrl !== "string" || typeof descriptor.photoVersion !== "string" || !uuid.test(descriptor.photoVersion))
    return false;
  return descriptor.photoUrl === `/api/profile/photo/${tenantId}/${ownerId}?v=${descriptor.photoVersion}`;
}

export async function loadLocalPhotoDescriptor(
  ownerId: number,
  tenantId: number,
): Promise<StoredPhotoDescriptor | null> {
  try {
    const confirmed = getConfirmedPhotoDescriptor(ownerId, tenantId);
    if (confirmed) return confirmed;
    // A new hook must not read storage while an earlier save or logout clear is pending.
    await ownerOperations.get(ownerId)?.catch(() => undefined);
    const raw = await AsyncStorage.getItem(storageKey(ownerId, tenantId));
    const latest = getConfirmedPhotoDescriptor(ownerId, tenantId);
    if (latest) return latest;
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (getAuthSnapshot().user?.id !== ownerId || !value || typeof value !== "object") return null;
    const stored = value as Record<string, unknown>;
    if (!Number.isSafeInteger(stored.savedAt) || (stored.savedAt as number) <= 0 ||
        !validLocalPhotoDescriptor(stored.descriptor, ownerId, tenantId)) return null;
    return stored as StoredPhotoDescriptor;
  } catch {
    return null;
  }
}

export async function saveLocalPhotoDescriptor(
  ownerId: number,
  tenantId: number,
  descriptor: ProfilePhotoDescriptor,
  savedAt = Date.now(),
): Promise<void> {
  if (!validLocalPhotoDescriptor(descriptor, ownerId, tenantId))
    throw new Error("Phone11 returned an unexpected photo response.");
  if (!Number.isSafeInteger(savedAt) || savedAt <= 0) throw new Error("Invalid profile photo timestamp.");
  await enqueueOwnerOperation(ownerId, async () => {
    if (getAuthSnapshot().user?.id !== ownerId) return;
    await AsyncStorage.setItem(storageKey(ownerId, tenantId), JSON.stringify({ descriptor, savedAt }));
  });
}

function clearOwnerPhotoDescriptors(ownerId: number): Promise<void> {
  return enqueueOwnerOperation(ownerId, async () => {
  try {
    const ownerPrefix = `${prefix}${ownerId}:tenant:`;
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(ownerPrefix));
    await Promise.all(keys.map((key) => AsyncStorage.removeItem(key)));
  } catch {
    // The authenticated image endpoint still prevents a signed-out account from reading it.
  }
  });
}

let previousOwnerId = getAuthSnapshot().user?.id ?? null;
addAuthChangeListener(() => {
  const nextOwnerId = getAuthSnapshot().user?.id ?? null;
  if (previousOwnerId !== null && nextOwnerId !== previousOwnerId) {
    const ownerPrefix = `${prefix}${previousOwnerId}:tenant:`;
    for (const key of confirmedPhotos.keys()) if (key.startsWith(ownerPrefix)) confirmedPhotos.delete(key);
    void clearOwnerPhotoDescriptors(previousOwnerId);
  }
  previousOwnerId = nextOwnerId;
});
