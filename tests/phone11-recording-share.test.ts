import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

// Import after the native/auth mocks so the production defaults stay inert.
// eslint-disable-next-line import/first
import {
  saveNativeRecording,
  shareAuthenticatedRecording,
  type NativeRecordingShareRuntime,
  type RecordingShareDependencies,
} from "../lib/cloud-recordings/recording-share";

const callUuid = "11111111-1111-4111-8111-111111111111";
const path = `/api/recordings/play/${callUuid}`;

function dependencies(
  overrides: Partial<RecordingShareDependencies> = {},
): RecordingShareDependencies {
  const identity = {};
  return {
    identity: () => identity,
    token: vi.fn(async () => "secret-bearer"),
    request: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "audio/wav" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
    saveNative: vi.fn(async () => {}),
    saveWeb: vi.fn(async () => {}),
    ...overrides,
  };
}

it("downloads Android recordings with a bearer header and rechecks the session", async () => {
  const deps = dependencies();
  await shareAuthenticatedRecording(
    { callUuid, path, platform: "android", base: "https://api.phone11.ai" },
    deps,
  );
  expect(deps.request).toHaveBeenCalledWith(`https://api.phone11.ai${path}`, {
    credentials: "omit",
    headers: { Authorization: "Bearer secret-bearer" },
  });
  expect(vi.mocked(deps.request).mock.calls[0][0]).not.toContain(
    "secret-bearer",
  );
  expect(deps.token).toHaveBeenCalledTimes(2);
  expect(deps.saveNative).toHaveBeenCalledWith(
    new Uint8Array([1, 2, 3]),
    `Phone11-${callUuid}.wav`,
    "audio/wav",
  );
  expect(deps.saveWeb).not.toHaveBeenCalled();
});

it("uses browser cookies without reading or exposing a native bearer", async () => {
  const token = vi.fn(async () => "unused");
  const deps = dependencies({ token });
  await shareAuthenticatedRecording(
    { callUuid, path, platform: "web", base: "https://api.phone11.ai" },
    deps,
  );
  expect(token).not.toHaveBeenCalled();
  expect(deps.request).toHaveBeenCalledWith(`https://api.phone11.ai${path}`, {
    credentials: "include",
  });
  expect(deps.saveWeb).toHaveBeenCalledOnce();
});

it("drops downloaded bytes when owner, token, or screen authorization changes", async () => {
  const owner = {};
  let current: object | null = owner;
  const ownerChanged = dependencies({
    identity: () => current,
    request: vi.fn(async () => {
      current = {};
      return {
        ok: true,
        status: 200,
        headers: { get: () => "audio/mpeg" },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      };
    }),
  });
  await expect(
    shareAuthenticatedRecording(
      { callUuid, path, platform: "android", base: "https://api.phone11.ai" },
      ownerChanged,
    ),
  ).rejects.toThrow("session changed");
  expect(ownerChanged.saveNative).not.toHaveBeenCalled();

  const token = vi
    .fn<() => Promise<string | null>>()
    .mockResolvedValueOnce("first")
    .mockResolvedValueOnce("replacement");
  const tokenChanged = dependencies({ token });
  await expect(
    shareAuthenticatedRecording(
      { callUuid, path, platform: "android", base: "https://api.phone11.ai" },
      tokenChanged,
    ),
  ).rejects.toThrow("session changed");
  expect(tokenChanged.saveNative).not.toHaveBeenCalled();

  let authorized = true;
  const screenChanged = dependencies({
    request: vi.fn(async () => {
      authorized = false;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "audio/wav" },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      };
    }),
  });
  await expect(
    shareAuthenticatedRecording(
      {
        callUuid,
        path,
        platform: "android",
        base: "https://api.phone11.ai",
        canShare: () => authorized,
      },
      screenChanged,
    ),
  ).rejects.toThrow("session changed");
  expect(screenChanged.saveNative).not.toHaveBeenCalled();
});

it("rejects invalid and empty responses before opening a share sheet", async () => {
  const invalid = dependencies({
    request: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })),
  });
  await expect(
    shareAuthenticatedRecording(
      { callUuid, path, platform: "android", base: "https://api.phone11.ai" },
      invalid,
    ),
  ).rejects.toThrow("invalid");
  expect(invalid.saveNative).not.toHaveBeenCalled();

  const empty = dependencies({
    request: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "audio/wav" },
      arrayBuffer: async () => new ArrayBuffer(0),
    })),
  });
  await expect(
    shareAuthenticatedRecording(
      { callUuid, path, platform: "android", base: "https://api.phone11.ai" },
      empty,
    ),
  ).rejects.toThrow("empty");
  expect(empty.saveNative).not.toHaveBeenCalled();
});

it("deletes the Android cache file even when the share sheet fails", async () => {
  let exists = false;
  const file = {
    uri: "file:///cache/recording.wav",
    get exists() {
      return exists;
    },
    create: vi.fn(() => {
      exists = true;
    }),
    write: vi.fn(),
    delete: vi.fn(() => {
      exists = false;
    }),
  };
  const runtime: NativeRecordingShareRuntime = {
    available: vi.fn(async () => true),
    createFile: vi.fn(() => file),
    share: vi.fn(async () => {
      throw new Error("cancelled");
    }),
  };
  await expect(
    saveNativeRecording(
      new Uint8Array([1]),
      "recording.wav",
      "audio/wav",
      runtime,
    ),
  ).rejects.toThrow("cancelled");
  expect(file.delete).toHaveBeenCalledOnce();
  expect(exists).toBe(false);
});
