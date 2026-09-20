import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: { id: 1 } as any,
  loading: false,
  chat: { userId: 1, workspace: { id: 10 } },
  token: vi.fn(),
  fetch: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  createDownload: vi.fn(),
  cancelDownload: vi.fn(),
  fileInfo: vi.fn(),
  remove: vi.fn(),
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
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  FileSystemSessionType: { FOREGROUND: 0 },
  uploadAsync: (...args: any[]) => m.upload(...args),
  createDownloadResumable: (...args: any[]) => m.createDownload(...args),
  getInfoAsync: (...args: any[]) => m.fileInfo(...args),
  deleteAsync: (...args: any[]) => m.remove(...args),
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
  m.upload.mockReset();
  m.download.mockReset().mockResolvedValue({
    status: 200,
    uri: "file:///cache/voice.m4a",
  });
  m.cancelDownload.mockReset().mockResolvedValue(undefined);
  m.createDownload.mockReset().mockImplementation(() => ({
    downloadAsync: (...args: any[]) => m.download(...args),
    cancelAsync: (...args: any[]) => m.cancelDownload(...args),
  }));
  m.fileInfo.mockReset().mockResolvedValue({
    exists: true,
    uri: "file:///cache/voice.m4a",
    isDirectory: false,
    size: 8_192,
    modificationTime: 1,
  });
  m.remove.mockReset().mockResolvedValue(undefined);
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
  const media = await getChatMediaSource("attachment", {
    filename: "voice.m4a",
    sizeBytes: 8_192,
  });
  expect(media.source).toEqual({ uri: "file:///cache/voice.m4a" });
  expect(m.createDownload).toHaveBeenCalledWith(
    "https://api.phone11.test/api/chat/media/attachment",
    expect.stringMatching(/^file:\/\/\/cache\/chat-play-attachment-/),
    {
      headers: expect.objectContaining({
        "X-Phone11-Chat-Owner": "1",
        "X-Phone11-Chat-Tenant": "10",
      }),
      sessionType: 0,
    },
    expect.any(Function),
  );
  m.user = { id: 1 };
  expect(media.assertOwner).toThrow("account or workspace changed");
  media.release();
  expect(m.remove).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/cache\/chat-play-attachment-/),
    { idempotent: true },
  );
});
it("rejects and removes a truncated native playback download", async () => {
  m.fileInfo.mockResolvedValueOnce({
    exists: true,
    uri: "file:///cache/voice.m4a",
    isDirectory: false,
    size: 128,
    modificationTime: 1,
  });
  await expect(
    getChatMediaSource("attachment", {
      filename: "voice.m4a",
      sizeBytes: 8_192,
    }),
  ).rejects.toThrow("Attachment is unavailable");
  expect(m.remove).toHaveBeenCalledOnce();
});
it("rejects playback descriptors above the 10 MiB media limit", async () => {
  await expect(
    getChatMediaSource("attachment", {
      filename: "voice.m4a",
      sizeBytes: 10 * 1024 * 1024 + 1,
    }),
  ).rejects.toThrow("Attachment is unavailable");
  expect(m.token).not.toHaveBeenCalled();
  expect(m.createDownload).not.toHaveBeenCalled();
});
it("cancels and cleans up a native playback download after 30 seconds", async () => {
  vi.useFakeTimers();
  let finishDownload!: (result: {
    status: number;
    uri: string;
  }) => void;
  m.download.mockReturnValue(
    new Promise((resolve) => {
      finishDownload = resolve;
    }),
  );
  const media = getChatMediaSource("attachment", {
    filename: "voice.m4a",
    sizeBytes: 8_192,
  });
  const timedOut = expect(media).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(30_000);
  await timedOut;
  expect(m.cancelDownload).toHaveBeenCalledOnce();
  expect(m.remove).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/cache\/chat-play-attachment-/),
    { idempotent: true },
  );
  const removalsBeforeLateCompletion = m.remove.mock.calls.length;
  finishDownload({ status: 200, uri: "file:///cache/voice.m4a" });
  await Promise.resolve();
  expect(m.remove.mock.calls.length).toBeGreaterThan(
    removalsBeforeLateCompletion,
  );
  vi.useRealTimers();
});
it("cancels a native playback download when its consumer closes", async () => {
  m.download.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const media = getChatMediaSource(
    "attachment",
    { filename: "voice.m4a", sizeBytes: 8_192 },
    controller.signal,
  );
  controller.abort();
  await expect(media).rejects.toMatchObject({ name: "AbortError" });
  expect(m.cancelDownload).toHaveBeenCalledOnce();
  expect(m.remove).toHaveBeenCalled();
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
it("rejects an already-cancelled voice upload before credentials or file access", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    uploadChatMedia(
      10,
      "room",
      {
        uri: "file:///voice.m4a",
        filename: "voice-note.m4a",
        mimeType: "audio/mp4",
      },
      "client",
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(m.token).not.toHaveBeenCalled();
});
it("keeps the upload deadline when a cancellation signal is supplied", async () => {
  vi.useFakeTimers();
  m.upload.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const upload = uploadChatMedia(
    10,
    "room",
    {
      uri: "file:///voice.m4a",
      filename: "voice-note.m4a",
      mimeType: "audio/mp4",
      sizeBytes: 8_192,
    },
    "client",
    controller.signal,
  );
  const timedOut = expect(upload).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(60_000);
  await timedOut;
  vi.useRealTimers();
});
