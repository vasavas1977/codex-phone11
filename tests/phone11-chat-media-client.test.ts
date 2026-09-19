import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: { id: 1 } as any,
  loading: false,
  chat: { userId: 1, workspace: { id: 10 } },
  token: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../constants/oauth", () => ({
  getApiBaseUrl: () => "https://api.phone11.test",
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: m.user, loading: m.loading }),
  getSessionToken: () => m.token(),
}));
vi.mock("../lib/chat/store", () => ({
  useChatStore: { getState: () => m.chat },
}));
import {
  chatMediaSession,
  getChatMediaSource,
  uploadChatMedia,
} from "../lib/chat/media-client";
beforeEach(() => {
  m.user = { id: 1 };
  m.loading = false;
  m.chat = { userId: 1, workspace: { id: 10 } };
  m.token.mockReset().mockResolvedValue("test-token");
});
it("binds the selected workspace before resolving credentials", async () => {
  let resolve!: (s: string) => void;
  m.token.mockReturnValue(new Promise<string>((r) => (resolve = r)));
  const session = chatMediaSession();
  m.chat.workspace = { id: 20 };
  resolve("test-token");
  await expect(session).rejects.toThrow("workspace changed");
});
it("media URLs retain owner and selected tenant assertions", async () => {
  const media = await getChatMediaSource("attachment");
  expect(media.source.headers).toMatchObject({
    "X-Phone11-Chat-Owner": "1",
    "X-Phone11-Chat-Tenant": "10",
  });
  m.user = { id: 1 };
  expect(media.assertOwner).toThrow("account or workspace changed");
});
it("refuses upload into a prior workspace before any file/network operation", async () => {
  await expect(
    uploadChatMedia(
      20,
      "room",
      {
        uri: "file:///photo.png",
        filename: "photo.png",
        mimeType: "image/png",
      },
      "client",
    ),
  ).rejects.toThrow("workspace changed");
});
it("rejects a chat store belonging to a different signed-in user", async () => {
  m.chat.userId = 2;
  await expect(chatMediaSession()).rejects.toThrow("workspace");
  expect(m.token).not.toHaveBeenCalled();
});
