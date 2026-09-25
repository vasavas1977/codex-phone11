import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  owner: null as any,
  authListeners: [] as Array<() => void>,
  chat: null as any,
  sip: null as any,
  query: null as any,
  mutation: null as any,
  queryInputs: [] as any[],
  queryOptions: [] as any[],
  photoQuery: null as any,
  photoStorage: new Map<string, string>(),
  photoStorageFails: false,
  photoStorageRead: null as Promise<string | null> | null,
  uploadPhoto: vi.fn(),
  removePhoto: vi.fn(),
  cameraGranted: true,
  libraryGranted: true,
  pickerResult: { canceled: true } as any,
  loadChannels: vi.fn(),
  hub: null as any,
  frame: { values: [] as any[], index: 0, effectIndex: 0,
    effects: [] as Array<{ deps?: readonly unknown[]; cleanup?: () => void }> },
}));
vi.mock("react", async () => {
  const actual: any = await vi.importActual("react");
  return { ...actual,
    useState: (initial: any) => { const frame = m.frame, index = frame.index++; if (index >= frame.values.length) frame.values[index] = initial; return [frame.values[index], (value: any) => { frame.values[index] = typeof value === "function" ? value(frame.values[index]) : value; }]; },
    useRef: (initial: any) => { const frame = m.frame, index = frame.index++; if (index >= frame.values.length) frame.values[index] = { current: initial }; return frame.values[index]; },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const frame = m.frame, index = frame.effectIndex++, previous = frame.effects[index];
      if (previous && deps && previous.deps && deps.length === previous.deps.length &&
          deps.every((value, position) => Object.is(value, previous.deps![position]))) return;
      previous?.cleanup?.();
      const cleanup = effect();
      frame.effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
    },
  };
});
vi.mock("../lib/trpc", () => ({ trpc: { profile: {
  photoCapability: { useQuery: (_input: any, _options: any) => m.photoQuery },
  self: { useQuery: (input: any, options: any) => { m.queryInputs.push(input); m.queryOptions.push(options); return m.query; } },
  update: { useMutation: () => m.mutation },
} } }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.owner, loading: false }),
  addAuthChangeListener: (listener: () => void) => { m.authListeners.push(listener); return () => {}; },
}));
vi.mock("../lib/profile/photo-client", () => ({
  isSupportedMime: (mime: string) => mime === "image/jpeg" || mime === "image/png" || mime === "image/webp",
  uploadWorkspaceProfilePhoto: (...args: any[]) => m.uploadPhoto(...args),
  removeWorkspaceProfilePhoto: (...args: any[]) => m.removePhoto(...args),
}));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: async () => ({ granted: m.cameraGranted }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: m.libraryGranted }),
  launchCameraAsync: async () => m.pickerResult,
  launchImageLibraryAsync: async () => m.pickerResult,
  CameraType: { front: "front" },
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => m.photoStorageRead ? await m.photoStorageRead : m.photoStorage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { if (m.photoStorageFails) throw new Error("disk unavailable"); m.photoStorage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { m.photoStorage.delete(key); }),
  getAllKeys: vi.fn(async () => [...m.photoStorage.keys()]),
} }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => m.chat, { getState: () => m.chat }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.owner }) }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: (select: any) => select({ account: m.sip }) }));
vi.mock("../components/profile/account-hub", () => ({ AccountHub: (props: any) => { m.hub = props; return createElement("div", null, props.workspaceName); } }));
vi.mock("../components/profile/profile-avatar", () => ({ useProfilePhotoCacheScope: vi.fn() }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: any) => createElement("div", null, children) }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), push: vi.fn() } }));

import ProfileScreen from "../app/profile/index";
import { useWorkspaceProfile } from "../lib/profile/use-workspace-profile";
import { getConfirmedPhotoDescriptor } from "../lib/profile/local-photo-descriptor";

const owner = (id: number) => ({ id, openId: `owner-${id}`, name: `Owner ${id}`, email: `${id}@example.com`, loginMethod: "email", lastSignedIn: new Date(0) });
const deferred = () => { let resolve!: (value: any) => void, reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const useRenderedWorkspaceProfile = (user = m.owner, tenantId = m.chat?.workspace?.id) => {
  m.frame.index = 0; m.frame.effectIndex = 0;
  return useWorkspaceProfile(user, tenantId);
};
const renderProfile = () => {
  m.frame.index = 0; m.frame.effectIndex = 0;
  return renderToStaticMarkup(createElement(ProfileScreen));
};

beforeEach(() => {
  vi.clearAllMocks();
  m.owner = null;
  m.authListeners.forEach((listener) => listener());
  m.owner = owner(1); m.chat = { userId: 1, workspace: { id: 20, name: "Selected work" }, loading: false, error: null, loadChannels: m.loadChannels };
  m.authListeners.forEach((listener) => listener());
  m.sip = { ownerUserId: 1, tenantId: 10, username: "3001" };
  m.queryInputs = []; m.queryOptions = []; m.hub = null;
  m.frame = { values: [], index: 0, effectIndex: 0, effects: [] };
  m.photoStorage.clear();
  m.photoStorageFails = false; m.photoStorageRead = null;
  m.cameraGranted = true; m.libraryGranted = true; m.pickerResult = { canceled: true };
  m.uploadPhoto.mockReset(); m.removePhoto.mockReset();
  m.loadChannels.mockResolvedValue(undefined);
  m.photoQuery = { data: { available: false }, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue({ data: { available: false } }) };
  m.query = { data: { userId: 1 }, isSuccess: true, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue({ data: { userId: 1 } }) };
  m.mutation = { mutateAsync: vi.fn().mockResolvedValue({ userId: 1 }) };
});

it("broadcasts a confirmed upload and removal to a separately mounted chat hook when storage fails", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status unavailable") };
  m.photoStorageFails = true;
  const profileFrame = m.frame;
  const photo = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174000",
    photoVersion: "123e4567-e89b-42d3-a456-426614174000",
  };
  m.uploadPhoto.mockResolvedValue(photo);
  m.removePhoto.mockResolvedValue({ userId: 1, photoUrl: null, photoVersion: null });
  const profile = useRenderedWorkspaceProfile();
  const chatFrame = { values: [], index: 0, effectIndex: 0, effects: [] } as typeof m.frame;
  m.frame = chatFrame;
  useRenderedWorkspaceProfile();
  m.frame = profileFrame;
  await profile.uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  m.frame = chatFrame;
  expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual(photo);
  m.frame = profileFrame;
  await profile.removePhoto();
  m.frame = chatFrame;
  expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual({ userId: 1, photoUrl: null, photoVersion: null });
  expect(m.query.refetch).not.toHaveBeenCalled();
});

it("keeps confirmed photos inside their owner and workspace after switches", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false };
  const photo = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174002",
    photoVersion: "123e4567-e89b-42d3-a456-426614174002",
  };
  m.uploadPhoto.mockResolvedValue(photo);
  await useRenderedWorkspaceProfile().uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  m.chat = { ...m.chat, workspace: { id: 30, name: "Other work" } };
  expect(useRenderedWorkspaceProfile(m.owner, 30).photoDescriptor).toBeNull();
  m.owner = owner(2);
  m.chat = { userId: 2, workspace: { id: 20, name: "Other owner" } };
  m.authListeners.forEach((listener) => listener());
  expect(useRenderedWorkspaceProfile(m.owner, 20).photoDescriptor).toBeNull();
  expect(getConfirmedPhotoDescriptor(1, 20)).toBeNull();
});

it("gives a new chat hook the confirmed result while its local write is pending", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status unavailable") };
  const write = deferred();
  const photo = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174001",
    photoVersion: "123e4567-e89b-42d3-a456-426614174001",
  };
  const storage = await import("@react-native-async-storage/async-storage");
  vi.mocked(storage.default.setItem).mockImplementationOnce(async () => { await write.promise; });
  m.uploadPhoto.mockResolvedValue(photo);
  const request = useRenderedWorkspaceProfile().uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  try {
    await vi.waitFor(() => expect(getConfirmedPhotoDescriptor(1, 20)?.descriptor).toEqual(photo));
    m.frame = { values: [], index: 0, effectIndex: 0, effects: [] };
    useRenderedWorkspaceProfile();
    expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual(photo);
  } finally {
    write.resolve(undefined);
  }
  await request;
});

it("uses the authenticated selected Team Chat workspace instead of the SIP tenant", () => {
  const route = ProfileScreen() as ReactElement<{ children: ReactElement }>;
  expect(route.props.children.key).toBe("1:20");
  renderProfile();
  expect(m.queryInputs.at(-1)).toEqual({ tenantId: 20 });
  expect(m.hub).toMatchObject({ workspaceName: "Selected work", phone: { extension: "3001" } });
  m.chat = { userId: 2, workspace: { id: 30, name: "Another owner" }, loading: false, error: null, loadChannels: m.loadChannels };
  m.frame = { values: [], index: 0, effectIndex: 0, effects: [] };
  renderProfile();
  expect(m.queryInputs.at(-1)).toEqual({ tenantId: 0 });
  expect(m.queryOptions.at(-1).enabled).toBe(false);
  expect(m.hub.workspaceName).toBeUndefined();
  expect(m.hub.profileAvailable).toBe(false);
});

it("hydrates the selected Team Chat workspace when My Profile opens first, with explicit retry", async () => {
  m.chat = { userId: 1, workspace: null, loading: false, error: null, loadChannels: m.loadChannels };
  renderProfile();
  expect(m.loadChannels).toHaveBeenCalledOnce();
  expect(m.queryOptions.at(-1).enabled).toBe(false);
  expect(m.hub).toMatchObject({ profilePhotoChecking: false, profilePhotoCheckError: false });
  await m.hub.onRetryProfilePhoto();
  expect(m.loadChannels).toHaveBeenCalledTimes(2);
});

it("suppresses stale save, refetch, error, and rendered data after owner and workspace changes", async () => {
  const oldSave = deferred(); m.mutation.mutateAsync.mockReturnValueOnce(oldSave.promise);
  const first = useRenderedWorkspaceProfile(); expect(first.profileAvailable).toBe(true);
  const request = first.save({ workLocation: "remote" });
  m.owner = owner(2); m.chat = { userId: 2, workspace: { id: 30, name: "New work" } };
  m.query = { ...m.query, data: { userId: 1 }, refetch: vi.fn() };
  const switched = useRenderedWorkspaceProfile(m.owner, 30);
  expect(switched.profile).toBeUndefined(); expect(switched.profileAvailable).toBe(false); expect(switched.saving).toBe(false); expect(switched.error).toBeNull();
  oldSave.resolve({ userId: 1 }); await request;
  expect(m.query.refetch).not.toHaveBeenCalled();

  const rejected = deferred(); m.owner = owner(1); m.chat = { userId: 1, workspace: { id: 20, name: "Old work" } }; m.mutation.mutateAsync.mockReturnValueOnce(rejected.promise);
  const old = useRenderedWorkspaceProfile(m.owner, 20); const failing = old.save({ workLocation: "office" });
  m.owner = owner(2); m.chat = { userId: 2, workspace: { id: 30, name: "New work" } }; useRenderedWorkspaceProfile(m.owner, 30);
  rejected.reject(new Error("old private failure")); await expect(failing).rejects.toThrow("old private failure");
  const current = useRenderedWorkspaceProfile(m.owner, 30); expect(current.error).toBeNull(); expect(current.saving).toBe(false);
});

it("keeps a same-scope save current across its pending rerender", async () => {
  const save = deferred(); m.mutation.mutateAsync.mockReturnValueOnce(save.promise);
  const first = useRenderedWorkspaceProfile(); const request = first.save({ workLocation: "remote" });
  expect(useRenderedWorkspaceProfile().saving).toBe(true);
  save.resolve({ userId: 1 }); await request;
  expect(m.query.refetch).toHaveBeenCalledOnce();
  expect(useRenderedWorkspaceProfile().saving).toBe(false);
});

it("allows a commissioned photo while the separate workspace status service is unavailable", () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status schema missing") };
  m.photoQuery = { ...m.photoQuery, data: { available: true } };
  renderProfile();
  expect(m.hub).toMatchObject({
    profileAvailable: false,
    profilePhotoAvailable: true,
    profilePhotoChecking: false,
    profilePhotoCheckError: false,
  });
});

it("retries workspace status only for the active owner and workspace", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status unavailable") };
  const profile = useRenderedWorkspaceProfile();
  await profile.refetchProfile();
  expect(m.query.refetch).toHaveBeenCalledOnce();
  m.query.refetch.mockClear();
  m.chat = { ...m.chat, workspace: { id: 30, name: "Other work" } };
  await profile.refetchProfile();
  expect(m.query.refetch).not.toHaveBeenCalled();
});

it("shows a successful upload even if local persistence fails, without refetching unavailable status", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status schema missing") };
  m.photoQuery = { ...m.photoQuery, data: { available: true } };
  m.photoStorageFails = true;
  const descriptor = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174000",
    photoVersion: "123e4567-e89b-42d3-a456-426614174000",
  };
  m.uploadPhoto.mockResolvedValue(descriptor);
  const first = useRenderedWorkspaceProfile();
  await expect(first.uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" })).resolves.toEqual(descriptor);
  expect(m.query.refetch).not.toHaveBeenCalled();
  expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual(descriptor);
});

it("does not let a delayed cached descriptor replace a newer upload", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status schema missing") };
  const old = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174000",
    photoVersion: "123e4567-e89b-42d3-a456-426614174000",
  };
  const next = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174001",
    photoVersion: "123e4567-e89b-42d3-a456-426614174001",
  };
  const lateRead = deferred();
  m.photoStorageRead = lateRead.promise as Promise<string | null>;
  m.uploadPhoto.mockResolvedValue(next);
  const first = useRenderedWorkspaceProfile();
  await first.uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  lateRead.resolve(JSON.stringify({ descriptor: old, savedAt: Date.now() - 10 }));
  await Promise.resolve(); await Promise.resolve();
  m.photoStorageRead = null;
  expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual(next);
});

it("restores the scoped photo after reopening and removes it without workspace status", async () => {
  m.query = { ...m.query, data: undefined, isSuccess: false, error: new Error("status schema missing") };
  m.photoQuery = { ...m.photoQuery, data: { available: true } };
  const photo = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174000",
    photoVersion: "123e4567-e89b-42d3-a456-426614174000",
  };
  m.uploadPhoto.mockResolvedValue(photo);
  await useRenderedWorkspaceProfile().uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  m.frame = { values: [], index: 0, effectIndex: 0, effects: [] }; // App screen remounts after reopening.
  useRenderedWorkspaceProfile();
  await Promise.resolve(); await Promise.resolve();
  const reopened = useRenderedWorkspaceProfile();
  expect(reopened.photoDescriptor).toEqual(photo);
  m.removePhoto.mockResolvedValue({ userId: 1, photoUrl: null, photoVersion: null });
  await reopened.removePhoto();
  expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual({ userId: 1, photoUrl: null, photoVersion: null });
});

it("prefers a confirmed stored photo over an older cached profile.self result on remount", async () => {
  const photo = {
    userId: 1,
    photoUrl: "/api/profile/photo/20/1?v=123e4567-e89b-42d3-a456-426614174000",
    photoVersion: "123e4567-e89b-42d3-a456-426614174000",
  };
  m.query = { ...m.query, data: { userId: 1, photoUrl: null, photoVersion: null }, dataUpdatedAt: 1 };
  m.uploadPhoto.mockResolvedValue(photo);
  await useRenderedWorkspaceProfile().uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  m.frame = { values: [], index: 0, effectIndex: 0, effects: [] };
  useRenderedWorkspaceProfile();
  await Promise.resolve(); await Promise.resolve();
  expect(useRenderedWorkspaceProfile().photoDescriptor).toEqual(photo);
});

it("surfaces a scoped picker permission and format error in the photo sheet", async () => {
  m.photoQuery = { ...m.photoQuery, data: { available: true } };
  m.libraryGranted = false;
  renderProfile();
  await expect(m.hub.onChangeProfilePhoto("library")).resolves.toBe(false);
  renderProfile();
  expect(m.hub.profilePhotoError).toBe("Allow photo library access to choose a profile photo.");

  m.libraryGranted = true;
  m.pickerResult = { canceled: false, assets: [{ uri: "file://photo.gif", fileName: "photo.gif", mimeType: "image/gif" }] };
  await expect(m.hub.onChangeProfilePhoto("library")).resolves.toBe(false);
  renderProfile();
  expect(m.hub.profilePhotoError).toBe("Choose a JPEG, PNG, or WebP photo.");
  m.chat = { ...m.chat, workspace: { id: 30, name: "Another workspace" } };
  renderProfile();
  expect(m.hub.profilePhotoError).toBeNull();
});

it("does not revive an obsolete pending photo action after an A to B to A scope switch", async () => {
  const ownerA = m.owner;
  const pending = deferred();
  m.uploadPhoto.mockReturnValueOnce(pending.promise);
  const request = useRenderedWorkspaceProfile().uploadPhoto({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  expect(useRenderedWorkspaceProfile().photoSaving).toBe(true);
  m.owner = owner(2); m.chat = { userId: 2, workspace: { id: 30, name: "B" } };
  expect(useRenderedWorkspaceProfile(m.owner, 30).photoSaving).toBe(false);
  m.owner = ownerA; m.chat = { userId: 1, workspace: { id: 20, name: "A" } };
  expect(useRenderedWorkspaceProfile(ownerA, 20).photoSaving).toBe(false);
  pending.resolve({ userId: 1, photoUrl: null, photoVersion: null });
  await request;
  const resumed = useRenderedWorkspaceProfile(ownerA, 20);
  expect(resumed.photoSaving).toBe(false);
  expect(resumed.photoDescriptor).toBeNull();
});
