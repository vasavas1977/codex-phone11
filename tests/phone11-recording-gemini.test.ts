import { describe, expect, it, vi } from "vitest";
import {
  analyzeRecordingAudio,
  completeRecordingAnalysis,
} from "../server/cloud-recordings/gemini";
const origin = "https://generativelanguage.googleapis.com";
const audio = Buffer.alloc(44);
audio.write("RIFF");
audio.write("WAVE", 8);
const analysis = {
  transcript: "Speaker 1: สวัสดี\nSpeaker 2: ตกลงส่งใบเสนอราคา",
  summary: {
    summary: "ตกลงส่งใบเสนอราคา",
    actionItems: ["ส่งใบเสนอราคา"],
    language: "th",
  },
};
it("rejects a partial analysis at the shared completion boundary", () => {
  expect(
    completeRecordingAnalysis({
      transcript: "Speaker 1: hello\nSpeaker 2: hi",
      summary: { summary: "   ", actionItems: [], language: "en" },
    }),
  ).toBeNull();
  expect(
    completeRecordingAnalysis({
      transcript: "Speaker 1: hello\ncontinuation without a speaker",
      summary: analysis.summary,
    }),
  ).toBeNull();
});
function fixture(result: unknown = analysis, finishReason = "STOP") {
  const calls: string[] = [];
  let generations = 0;
  const request = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      calls.push(`${init?.method ?? "GET"} ${value}`);
      if (init?.method === "DELETE") return new Response(null, { status: 200 });
      if (value.endsWith("/upload/v1beta/files"))
        return new Response(null, {
          headers: { "x-goog-upload-url": `${origin}/upload/session` },
        });
      if (value.endsWith("/upload/session"))
        return Response.json({
          file: {
            name: "files/test",
            state: "ACTIVE",
            uri: `${origin}/v1beta/files/test`,
          },
        });
      const source = result as Partial<typeof analysis>;
      const generated =
        generations++ === 0
          ? { transcript: source?.transcript }
          : { summary: source?.summary };
      return Response.json({
        candidates: [
          {
            finishReason,
            content: { parts: [{ text: JSON.stringify(generated) }] },
          },
        ],
      });
    },
  );
  return {
    request,
    calls,
    options: {
      apiKey: "fixture-key",
      model: "fixture-model",
      fetch: request as typeof fetch,
    },
  };
}
describe("Gemini call analysis boundary", () => {
  it("uploads server audio, validates Thai output and deletes the provider file", async () => {
    const f = fixture();
    expect(
      await analyzeRecordingAudio(
        { bytes: audio, mimeType: "audio/wav" },
        f.options,
      ),
    ).toEqual(analysis);
    expect(f.calls).toEqual([
      `POST ${origin}/upload/v1beta/files`,
      `POST ${origin}/upload/session`,
      `POST ${origin}/v1beta/models/fixture-model:generateContent`,
      `POST ${origin}/v1beta/models/fixture-model:generateContent`,
      `DELETE ${origin}/v1beta/files/test`,
    ]);
    const transcriptBody = JSON.parse(
      f.request.mock.calls[2][1]?.body as string,
    );
    expect(transcriptBody.contents[0].parts[0].fileData.fileUri).toBe(
      `${origin}/v1beta/files/test`,
    );
    expect(transcriptBody.systemInstruction.parts[0].text).toContain(
      "final audible human speech",
    );
    expect(transcriptBody.systemInstruction.parts[0].text).toContain(
      "Do not skip",
    );
    expect(transcriptBody.generationConfig.maxOutputTokens).toBe(32768);
    expect(
      transcriptBody.generationConfig.responseSchema.properties.transcript
        .description,
    ).toContain("complete call");
    const summaryBody = JSON.parse(f.request.mock.calls[3][1]?.body as string);
    expect(JSON.parse(summaryBody.contents[0].parts[0].text)).toEqual({
      transcript: analysis.transcript,
    });
    expect(summaryBody.contents[0].parts[0].fileData).toBeUndefined();
    expect(summaryBody.systemInstruction.parts[0].text).toContain(
      "only as Speaker 1 and Speaker 2",
    );
    expect(summaryBody.systemInstruction.parts[0].text).toContain(
      "Never say Person 1",
    );
  });
  it.each([
    "สวัสดีโดยไม่มีชื่อผู้พูด",
    "Speaker 1: สวัสดี\nข้อความต่อเนื่องที่ไม่มีชื่อผู้พูด",
    "speaker 1: wrong case",
    " Speaker 1: leading whitespace",
    "Speaker1: missing space",
    "Speaker 3: unsupported speaker",
    "Speaker 1:",
    " \n\t ",
  ])(
    "rejects a malformed or unlabeled transcript instead of publishing it: %j",
    async (transcript) => {
      const f = fixture({ ...analysis, transcript });
      await expect(
        analyzeRecordingAudio(
          { bytes: audio, mimeType: "audio/wav" },
          f.options,
        ),
      ).rejects.toMatchObject({ code: "invalid_result", stage: "parse" });
      expect(f.calls.at(-1)).toBe(`DELETE ${origin}/v1beta/files/test`);
    },
  );
  it.each([
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
    [403, "provider_rejected"],
  ])(
    "classifies HTTP %s without retaining the provider response",
    async (status, code) => {
      const f = fixture();
      f.request.mockImplementationOnce(
        async () =>
          new Response("private provider details", { status: Number(status) }),
      );
      await expect(
        analyzeRecordingAudio(
          { bytes: audio, mimeType: "audio/wav" },
          f.options,
        ),
      ).rejects.toMatchObject({ code, stage: "upload_start" });
    },
  );
  it("keeps generation failures distinct and cleans up uploaded audio", async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) =>
      String(url).includes(":generateContent")
        ? new Response("private provider details", { status: 429 })
        : original(url, init),
    );
    await expect(
      analyzeRecordingAudio({ bytes: audio, mimeType: "audio/wav" }, f.options),
    ).rejects.toMatchObject({
      code: "provider_rate_limited",
      stage: "generate",
    });
    expect(f.calls.at(-1)).toContain("DELETE");
  });
  it("classifies malformed generated JSON as invalid_result instead of a transport failure", async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) =>
      String(url).includes(":generateContent")
        ? Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: "private incomplete JSON" }] },
              },
            ],
          })
        : original(url, init),
    );
    await expect(
      analyzeRecordingAudio({ bytes: audio, mimeType: "audio/wav" }, f.options),
    ).rejects.toMatchObject({ code: "invalid_result", stage: "parse" });
    expect(f.calls.at(-1)).toContain("DELETE");
  });
  it("distinguishes an expired deadline from a transport error", async () => {
    const signal = AbortSignal.abort();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const f = fixture();
    f.request.mockRejectedValue(new Error("private transport details"));
    try {
      await expect(
        analyzeRecordingAudio(
          { bytes: audio, mimeType: "audio/wav" },
          f.options,
        ),
      ).rejects.toMatchObject({
        code: "provider_timeout",
        stage: "upload_start",
      });
    } finally {
      timeout.mockRestore();
    }
  });
  it("requires explicit credentials and model before uploading", async () => {
    const f = fixture();
    await expect(
      analyzeRecordingAudio(
        { bytes: audio, mimeType: "audio/wav" },
        { ...f.options, apiKey: "" },
      ),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(f.request).not.toHaveBeenCalled();
  });
  it("rejects non WAV bytes", async () => {
    const f = fixture();
    await expect(
      analyzeRecordingAudio(
        { bytes: Buffer.alloc(44), mimeType: "audio/wav" },
        f.options,
      ),
    ).rejects.toMatchObject({ code: "invalid_audio" });
    expect(f.request).not.toHaveBeenCalled();
  });
  it("never forwards keys or audio to a foreign upload destination", async () => {
    const request = vi.fn(
      async () =>
        new Response(null, {
          headers: {
            "x-goog-upload-url": "https://untrusted.example/upload/session",
          },
        }),
    );
    await expect(
      analyzeRecordingAudio(
        { bytes: audio, mimeType: "audio/wav" },
        { ...fixture().options, fetch: request },
      ),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { ...analysis, summary: { ...analysis.summary, actionItems: [12] } },
  ])(
    "rejects malformed AI results and still deletes uploaded audio",
    async (result) => {
      const f = fixture(result);
      await expect(
        analyzeRecordingAudio(
          { bytes: audio, mimeType: "audio/wav" },
          f.options,
        ),
      ).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.calls.at(-1)).toBe(`DELETE ${origin}/v1beta/files/test`);
    },
  );
  it("does not publish a truncated or blocked result", async () => {
    const f = fixture(analysis, "MAX_TOKENS");
    await expect(
      analyzeRecordingAudio({ bytes: audio, mimeType: "audio/wav" }, f.options),
    ).rejects.toMatchObject({ code: "invalid_result" });
    expect(f.calls.at(-1)).toContain("DELETE");
  });
  it("does not publish when summary generation truncates after a complete transcript", async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    let generations = 0;
    f.request.mockImplementation(async (url, init) =>
      String(url).includes(":generateContent") && generations++ === 1
        ? Response.json({
            candidates: [
              { finishReason: "MAX_TOKENS", content: { parts: [] } },
            ],
          })
        : original(url, init),
    );
    await expect(
      analyzeRecordingAudio({ bytes: audio, mimeType: "audio/wav" }, f.options),
    ).rejects.toMatchObject({ code: "invalid_result", stage: "parse" });
    expect(f.calls.at(-1)).toContain("DELETE");
  });
  it("cleans up after provider failures without exposing provider details", async () => {
    const f = fixture();
    f.request
      .mockImplementationOnce(
        async () =>
          new Response(null, {
            headers: { "x-goog-upload-url": `${origin}/upload/session` },
          }),
      )
      .mockImplementationOnce(async () =>
        Response.json({
          file: {
            name: "files/test",
            state: "FAILED",
            uri: `${origin}/v1beta/files/test`,
          },
        }),
      );
    await expect(
      analyzeRecordingAudio({ bytes: audio, mimeType: "audio/wav" }, f.options),
    ).rejects.toThrow("Recording analysis provider_failed");
    expect(f.calls.at(-1)).toBe(`DELETE ${origin}/v1beta/files/test`);
  });
});
