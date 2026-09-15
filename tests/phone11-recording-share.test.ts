import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
import {
  shareAuthenticatedRecording,
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

it("downloads native recordings with a bearer header and shares only local bytes", async () => {
  const deps = dependencies();
  await shareAuthenticatedRecording(
    { callUuid, path, platform: "ios", base: "https://api.phone11.ai" },
    deps,
  );
  expect(deps.request).toHaveBeenCalledWith(
    `https://api.phone11.ai${path}`,
    {
      credentials: "omit",
      headers: { Authorization: "Bearer secret-bearer" },
    },
  );
  expect(vi.mocked(deps.request).mock.calls[0][0]).not.toContain("secret-bearer");
  expect(deps.saveNative).toHaveBeenCalledWith(
    new Uint8Array([1, 2, 3]),
    `Phone11-${callUuid}.wav`,
    "audio/wav",
  );
  expect(deps.saveWeb).not.toHaveBeenCalled();
});

it("keeps browser preview authenticated by its cookie and downloads locally", async () => {
  const token = vi.fn(async () => "unused");
  const deps = dependencies({ token });
  await shareAuthenticatedRecording(
    { callUuid, path, platform: "web", base: "https://api.phone11.ai" },
    deps,
  );
  expect(token).not.toHaveBeenCalled();
  expect(deps.request).toHaveBeenCalledWith(
    `https://api.phone11.ai${path}`,
    { credentials: "include" },
  );
  expect(deps.saveWeb).toHaveBeenCalledOnce();
  expect(deps.saveNative).not.toHaveBeenCalled();
});

it("drops downloaded bytes when the signed-in identity changes", async () => {
  const owner = {};
  const replacement = {};
  let current = owner;
  const deps = dependencies({
    identity: () => current,
    request: vi.fn(async () => {
      current = replacement;
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
      { callUuid, path, platform: "ios", base: "https://api.phone11.ai" },
      deps,
    ),
  ).rejects.toThrow("session changed");
  expect(deps.saveNative).not.toHaveBeenCalled();
});

it("rejects non-audio and empty responses before opening a share sheet", async () => {
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
      { callUuid, path, platform: "ios", base: "https://api.phone11.ai" },
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
      { callUuid, path, platform: "ios", base: "https://api.phone11.ai" },
      empty,
    ),
  ).rejects.toThrow("empty");
  expect(empty.saveNative).not.toHaveBeenCalled();
});
