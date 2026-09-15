import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudRecordingSummaryToolsRouter } from "../server/cloud-recordings/summary-tools-router";

const recordingTranslationError = vi.hoisted(() =>
  class extends Error {
    constructor(
      public readonly code:
        | "not_configured"
        | "provider_failed"
        | "invalid_result",
    ) {
      super(`Recording translation ${code}`);
    }
  },
);
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  getPolicy: vi.fn(),
  translate: vi.fn(),
}));

vi.mock("../server/cloud-recordings/repository", () => ({
  createCloudRecordingRepository: () => ({
    detail: mocks.detail,
    getPolicy: mocks.getPolicy,
  }),
}));

vi.mock("../server/cloud-recordings/summary-translation", () => {
  return {
    RecordingTranslationError: recordingTranslationError,
    translateRecordingSummary: mocks.translate,
  };
});

function caller(userId?: number) {
  return cloudRecordingSummaryToolsRouter.createCaller({
    user: userId ? ({ id: userId } as any) : null,
    req: { headers: {} } as any,
    res: {} as any,
  });
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 73,
    summaryStatus: "ready",
    summary: {
      summary: "Call summary",
      actionItems: ["Send the proposal"],
    },
    transcript: "Speaker 1: Hello\nSpeaker 2: Thank you",
    ...overrides,
  };
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 73,
    mode: "automatic",
    aiEnabled: true,
    ...overrides,
  };
}

describe("Phone11 summary translation authorization", () => {
  beforeEach(() => {
    mocks.detail.mockReset();
    mocks.getPolicy.mockReset();
    mocks.translate.mockReset();
    mocks.detail.mockResolvedValue(detail());
    mocks.getPolicy.mockResolvedValue(policy());
    mocks.translate.mockResolvedValue({
      summary: "สรุปการโทร",
      actionItems: ["ส่งข้อเสนอ"],
      transcript: "Speaker 1: สวัสดี\nSpeaker 2: ขอบคุณ",
      language: "th",
    });
  });

  it("requires an authenticated Phone11 user before reading a recording", async () => {
    await expect(
      caller().translate({ callUuid: "call-owned", targetLanguage: "th" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it("does not translate a recording the repository does not own", async () => {
    mocks.detail.mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "Recording not found" }),
    );

    await expect(
      caller(9401).translate({
        callUuid: "foreign-call",
        targetLanguage: "th",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.detail).toHaveBeenCalledWith(9401, "foreign-call");
    expect(mocks.getPolicy).not.toHaveBeenCalled();
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it("uses only the authenticated owner's server-side content", async () => {
    const owned = detail();
    mocks.detail.mockResolvedValueOnce(owned);

    await caller(9402).translate({
      callUuid: "owned-call",
      targetLanguage: "th",
    });

    expect(mocks.getPolicy).toHaveBeenCalledWith(9402, 73);
    expect(mocks.translate).toHaveBeenCalledWith({
      targetLanguage: "th",
      content: {
        ...owned.summary,
        transcript: owned.transcript,
      },
    });
  });

  it.each([
    { userId: 9403, change: { mode: "off" }, reason: "recording policy is off" },
    {
      userId: 9404,
      change: { aiEnabled: false },
      reason: "workspace AI is disabled",
    },
  ])("rejects translation when $reason", async ({ userId, change }) => {
    mocks.getPolicy.mockResolvedValueOnce(policy(change));

    await expect(
      caller(userId).translate({
        callUuid: "policy-disabled",
        targetLanguage: "th",
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "AI call tools are disabled for this workspace.",
    });
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it("does not send an unfinished summary to the provider", async () => {
    mocks.detail.mockResolvedValueOnce(
      detail({ summaryStatus: "processing", summary: undefined }),
    );

    await expect(
      caller(9405).translate({
        callUuid: "processing-call",
        targetLanguage: "th",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it("explains when the server-side Gemini translation setup is missing", async () => {
    const error = new recordingTranslationError("not_configured");
    mocks.translate.mockRejectedValueOnce(error);

    await expect(
      caller(9407).translate({
        callUuid: "translation-not-configured",
        targetLanguage: "th",
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Translation needs Gemini setup. Ask a Phone11 administrator to configure it.",
    });
  });

  it("keeps provider and malformed-result failures retryable", async () => {
    mocks.translate.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      caller(9408).translate({
        callUuid: "translation-provider-failed",
        targetLanguage: "en",
      }),
    ).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: "Translation service could not complete this request. Please try again.",
    });

    const invalid = new recordingTranslationError("invalid_result");
    mocks.translate.mockRejectedValueOnce(invalid);
    await expect(
      caller(9409).translate({
        callUuid: "translation-invalid-result",
        targetLanguage: "ja",
      }),
    ).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: "Translation returned an incomplete result. Please try again.",
    });
  });

  it("bounds translation requests per authenticated user", async () => {
    const api = caller(9406);
    for (let index = 0; index < 6; index++) {
      await api.translate({
        callUuid: `bounded-call-${index}`,
        targetLanguage: "th",
      });
    }

    await expect(
      api.translate({ callUuid: "bounded-call-6", targetLanguage: "th" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mocks.translate).toHaveBeenCalledTimes(6);
    expect(mocks.detail).toHaveBeenCalledTimes(6);
  });
});
