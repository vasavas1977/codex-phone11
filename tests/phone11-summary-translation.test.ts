import { expect, it, vi } from "vitest";
import { translateRecordingSummary } from "../server/cloud-recordings/summary-translation";

function response(payload: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(payload) }] },
        },
      ],
    }),
    { status: 200 },
  );
}

const input = {
  targetLanguage: "th" as const,
  content: {
    summary: "Send the proposal.",
    actionItems: ["Send proposal"],
    transcript: "Speaker 1: Hello\nSpeaker 2: Thank you",
  },
};

it("translates server-owned content and preserves strict speaker labels", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    response({
      summary: "ส่งข้อเสนอ",
      actionItems: ["ส่งข้อเสนอ"],
      transcript: "Speaker 1: สวัสดี\nSpeaker 2: ขอบคุณ",
      language: "th",
    }),
  );
  const translated = await translateRecordingSummary(input, {
    apiKey: "fixture-key",
    model: "fixture-model",
    fetch: request as typeof fetch,
  });
  expect(translated.transcript).toContain("Speaker 2: ขอบคุณ");
  const body = JSON.parse(
    String((request.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
  );
  expect(body.contents[0].parts[0].text).toContain("Send the proposal");
  expect(body.generationConfig.responseSchema.properties.language.enum).toEqual(
    ["th"],
  );
});

it.each([
  {
    transcript: "ผู้พูด 1: สวัสดี",
    reason: "localized label",
  },
  {
    transcript: "Speaker 1: สวัสดี\ncontinued without a label",
    reason: "unlabeled continuation",
  },
])(
  "rejects $reason instead of publishing ambiguous identities",
  async ({ transcript }) => {
    await expect(
      translateRecordingSummary(input, {
        apiKey: "fixture-key",
        model: "fixture-model",
        fetch: vi.fn(async () =>
          response({
            summary: "ส่งข้อเสนอ",
            actionItems: [],
            transcript,
            language: "th",
          }),
        ),
      }),
    ).rejects.toMatchObject({
      code: "invalid_result",
    });
  },
);

it.each([
  {
    transcript: "Speaker 1: สวัสดี",
    reason: "a dropped turn",
  },
  {
    transcript: "Speaker 2: ขอบคุณ\nSpeaker 1: สวัสดี",
    reason: "a reordered speaker sequence",
  },
  {
    transcript: "Speaker 1: สวัสดี\nSpeaker 2: ขอบคุณ\nSpeaker 1: เพิ่มข้อความ",
    reason: "an added turn",
  },
])("rejects $reason", async ({ transcript }) => {
  await expect(
    translateRecordingSummary(input, {
      apiKey: "fixture-key",
      model: "fixture-model",
      fetch: vi.fn(async () =>
        response({
          summary: "ส่งข้อเสนอ",
          actionItems: [],
          transcript,
          language: "th",
        }),
      ),
    }),
  ).rejects.toMatchObject({ code: "invalid_result" });
});

it("requires the translated transcript whenever the owned source had one", async () => {
  await expect(
    translateRecordingSummary(input, {
      apiKey: "fixture-key",
      model: "fixture-model",
      fetch: vi.fn(async () =>
        response({ summary: "ส่งข้อเสนอ", actionItems: [], language: "th" }),
      ),
    }),
  ).rejects.toMatchObject({ code: "invalid_result" });
});
