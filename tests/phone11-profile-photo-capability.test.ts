import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeWorkspace: vi.fn(),
  profilePhotosAvailable: vi.fn(),
  profilePhotoStorageReady: vi.fn(),
}));
vi.mock("../server/pbx/db", () => ({ getPool: () => ({}) }));
vi.mock("../server/chat/service", () => ({ authorizeWorkspace: mocks.authorizeWorkspace }));
vi.mock("../server/profile/photo", () => ({
  MAX_PROFILE_PHOTO_BYTES: 2 * 1024 * 1024,
  profilePhotoCommissioned: () => process.env.PHONE11_PROFILE_PHOTO_COMMISSIONED === "1",
  profilePhotosAvailable: mocks.profilePhotosAvailable,
  profilePhotoStorageReady: mocks.profilePhotoStorageReady,
}));

import { createProfileRouter } from "../server/profile/router";

const caller = (userId: number | null) => createProfileRouter().createCaller({
  user: userId === null ? null : { id: userId }, req: {}, res: {},
} as never);

describe("profile photo capability commissioning", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mocks.profilePhotosAvailable.mockResolvedValue(true);
    mocks.profilePhotoStorageReady.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "0", "true", "yes", " 1 "])(
    "keeps photos unavailable with commissioning value %s even when storage is ready",
    async value => {
      if (value !== undefined) vi.stubEnv("PHONE11_PROFILE_PHOTO_COMMISSIONED", value);
      expect((await caller(1).photoCapability({ tenantId: 10 })).available).toBe(false);
      expect(mocks.authorizeWorkspace).toHaveBeenCalledWith({}, 1, 10);
      expect(mocks.profilePhotosAvailable).not.toHaveBeenCalled();
      expect(mocks.profilePhotoStorageReady).not.toHaveBeenCalled();
    },
  );

  it("requires both schema and storage after explicit commissioning", async () => {
    vi.stubEnv("PHONE11_PROFILE_PHOTO_COMMISSIONED", "1");
    expect((await caller(1).photoCapability({ tenantId: 10 })).available).toBe(true);
    mocks.profilePhotosAvailable.mockResolvedValue(false);
    expect((await caller(1).photoCapability({ tenantId: 10 })).available).toBe(false);
    mocks.profilePhotosAvailable.mockResolvedValue(true);
    mocks.profilePhotoStorageReady.mockResolvedValue(false);
    expect((await caller(1).photoCapability({ tenantId: 10 })).available).toBe(false);
  });

  it("rejects unauthenticated and foreign-workspace callers while commissioned", async () => {
    vi.stubEnv("PHONE11_PROFILE_PHOTO_COMMISSIONED", "1");
    await expect(caller(null).photoCapability({ tenantId: 10 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.authorizeWorkspace.mockRejectedValueOnce(new Error("denied"));
    expect((await caller(2).photoCapability({ tenantId: 10 })).available).toBe(false);
    expect(mocks.profilePhotosAvailable).not.toHaveBeenCalled();
  });
});
