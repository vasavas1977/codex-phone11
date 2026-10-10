import { expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ownerId: 1 as number | null,
  listeners: [] as Array<() => void>,
  values: new Map<string, string>(),
  blockFirstWrite: null as Promise<void> | null,
  writeCount: 0,
}));

vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.ownerId === null ? null : { id: m.ownerId }, loading: false }),
  addAuthChangeListener: (listener: () => void) => { m.listeners.push(listener); return () => {}; },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => m.values.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    m.writeCount += 1;
    if (m.writeCount === 1 && m.blockFirstWrite) await m.blockFirstWrite;
    m.values.set(key, value);
  },
  removeItem: async (key: string) => { m.values.delete(key); },
  getAllKeys: async () => [...m.values.keys()],
} }));

import { loadLocalPhotoDescriptor, saveLocalPhotoDescriptor, validLocalPhotoDescriptor } from "../lib/profile/local-photo-descriptor";

const descriptor = (version: string) => ({
  userId: 1,
  photoUrl: `/api/profile/photo/20/1?v=${version}`,
  photoVersion: version,
});

it("accepts only the authenticated owner's tenant-bound server descriptor", () => {
  const photo = descriptor("123e4567-e89b-42d3-a456-426614174000");
  expect(validLocalPhotoDescriptor(photo, 1, 20)).toBe(true);
  expect(validLocalPhotoDescriptor(photo, 2, 20)).toBe(false);
  expect(validLocalPhotoDescriptor(photo, 1, 30)).toBe(false);
  expect(validLocalPhotoDescriptor({ ...photo, photoUrl: "https://example.invalid/photo.jpg" }, 1, 20)).toBe(false);
  expect(validLocalPhotoDescriptor({ userId: 1, photoUrl: null, photoVersion: null }, 1, 20)).toBe(true);
});

it("orders logout cleanup between an in-flight write and a later login write", async () => {
  const first = descriptor("123e4567-e89b-42d3-a456-426614174000");
  const second = descriptor("123e4567-e89b-42d3-a456-426614174001");
  let finishFirst!: () => void;
  m.blockFirstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
  const writing = saveLocalPhotoDescriptor(1, 20, first);
  await Promise.resolve(); await Promise.resolve();
  m.ownerId = null;
  for (const listener of m.listeners) listener();
  m.ownerId = 1;
  for (const listener of m.listeners) listener();
  const newer = saveLocalPhotoDescriptor(1, 20, second);
  finishFirst();
  await writing; await newer;
  expect((await loadLocalPhotoDescriptor(1, 20))?.descriptor).toEqual(second);
  m.ownerId = null;
  for (const listener of m.listeners) listener();
  // A read after logout cannot display even a descriptor pending deletion.
  expect(await loadLocalPhotoDescriptor(1, 20)).toBeNull();
});
