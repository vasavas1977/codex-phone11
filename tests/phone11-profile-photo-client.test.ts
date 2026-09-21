import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: { user: { id: 1 }, loading: false } as any,
  chat: { userId: 1, workspace: { id: 20 } } as any,
  fetch: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../constants/oauth", () => ({ getApiBaseUrl: () => "https://api.phone11.ai" }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth,
  getSessionToken: vi.fn(async () => null),
}));
vi.mock("../lib/chat/store", () => ({ useChatStore: { getState: () => m.chat } }));

import {
  removeWorkspaceProfilePhoto,
  uploadWorkspaceProfilePhoto,
} from "../lib/profile/photo-client";

beforeEach(() => {
  m.auth = { user: { id: 1 }, loading: false };
  m.chat = { userId: 1, workspace: { id: 20 } };
  m.fetch.mockReset();
  vi.stubGlobal("fetch", m.fetch);
});

it("uploads only through the selected tenant's authenticated profile route", async () => {
  const version = "123e4567-e89b-42d3-a456-426614174000";
  m.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      userId: 1,
      photoUrl: `/api/profile/photo/20/1?v=${version}`,
      photoVersion: version,
      mimeType: "image/jpeg",
    }),
  });
  await expect(uploadWorkspaceProfilePhoto(20, {
    uri: "blob:profile-photo",
    mimeType: "image/jpeg",
    file: new Blob(["photo"], { type: "image/jpeg" }),
  })).resolves.toMatchObject({ userId: 1, photoVersion: version });
  expect(m.fetch).toHaveBeenCalledWith(
    "https://api.phone11.ai/api/profile/photo",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "X-Phone11-Profile-Tenant": "20", "Content-Type": "image/jpeg" }),
    }),
  );
});

it("rejects unsupported files and a changed workspace before any upload", async () => {
  await expect(uploadWorkspaceProfilePhoto(20, { uri: "file://photo.gif", mimeType: "image/gif" }))
    .rejects.toThrow("JPEG, PNG, or WebP");
  m.chat = { userId: 1, workspace: { id: 21 } };
  await expect(uploadWorkspaceProfilePhoto(20, { uri: "file://photo.jpg", mimeType: "image/jpeg" }))
    .rejects.toThrow("Select an active workspace");
  expect(m.fetch).not.toHaveBeenCalled();
});

it("rejects known inputs above the final 2 MB and 2048 pixel limits before upload", async () => {
  await expect(uploadWorkspaceProfilePhoto(20, {
    uri: "file://large.jpg", mimeType: "image/jpeg", sizeBytes: 2 * 1024 * 1024 + 1,
  })).rejects.toThrow("smaller than 2 MB");
  await expect(uploadWorkspaceProfilePhoto(20, {
    uri: "file://wide.jpg", mimeType: "image/jpeg", width: 2049, height: 100,
  })).rejects.toThrow("up to 2048 by 2048");
  expect(m.fetch).not.toHaveBeenCalled();
});

it("uses the selected workspace again for deletion", async () => {
  m.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ userId: 1, photoUrl: null, photoVersion: null }),
  });
  await expect(removeWorkspaceProfilePhoto(20)).resolves.toMatchObject({ userId: 1, photoUrl: null });
  expect(m.fetch).toHaveBeenCalledWith(
    "https://api.phone11.ai/api/profile/photo/20",
    expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: expect.objectContaining({ "X-Phone11-Profile-Tenant": "20" }),
    }),
  );
});
