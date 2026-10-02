import { describe, expect, it, vi } from "vitest";

import {
  createConnect11PlainVideoFacade,
  readConnect11PlainVideoTokenRefusal,
} from "./connect11-plain-video-facade";

const config = {
  baseUrl: "https://connect11.example",
  statusCredential: "status-secret",
  joinCredential: "join-secret",
};
const capability = {
  contract_version: "phone11-plain-video.v1",
  available: true,
  unavailable_reasons: [],
  grant_profiles: ["interactive", "listener"],
  token_ttl_seconds: 300,
  interpreter: { enabled: false, dispatch: "none", status: "not_applicable" },
};
const admission = {
  meetingId: "meeting_01",
  participantId: "person_01",
  grantProfile: "interactive" as const,
};
const token = {
  contract_version: "phone11-plain-video.v1",
  rtc_url: "wss://media.example",
  access_token: "synthetic",
  expires_at: Math.floor(Date.now() / 1000) + 300,
};

function responses(...bodies: unknown[]) {
  return vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
}

describe("Connect11 plain video facade", () => {
  async function rejectedToken(response: Response) {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(capability)))
      .mockResolvedValueOnce(response);
    const error = await createConnect11PlainVideoFacade(config, request).admit(admission)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Plain video service is unavailable");
    expect((error as Error).cause).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    return error;
  }

  it.each(["no_billable_wallet", "insufficient_balance", "trial_expired"] as const)(
    "preserves only the exact token 402 category %s", async (category) => {
      const error = await rejectedToken(new Response(JSON.stringify({
        error: { code: "http_error", message: category, token: "private-token", url: "https://secret.example" },
        tenantId: 987,
      }), { status: 402 }));
      expect(readConnect11PlainVideoTokenRefusal(error)).toEqual({ category, httpStatus: 402 });
      expect(JSON.stringify(error)).not.toMatch(/private-token|secret.example|987/);
    },
  );

  it("keeps unknown, non-JSON, secret-shaped and unrelated statuses generic", async () => {
    for (const [status, body] of [
      [402, "not JSON token=private"],
      [402, ""],
      [402, JSON.stringify({ error: { code: "http_error", message: "trial_expired token=private" } })],
      [402, JSON.stringify({ error: { code: "trial_expired", message: "private" } })],
      [402, JSON.stringify({ error: { code: "other", message: "trial_expired" } })],
      [402, JSON.stringify({ __proto__: { error: { code: "http_error", message: "trial_expired" } } })],
      [401, JSON.stringify({ error: { code: "http_error", message: "trial_expired" } })],
      [500, JSON.stringify({ error: { code: "http_error", message: "trial_expired" } })],
    ] as const) {
      expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(new Response(body, { status })))).toBeUndefined();
    }
  });

  it("does not classify capability refusals or read their bodies as token errors", async () => {
    const json = vi.fn();
    const body = vi.fn();
    const response = { ok: false, status: 402, json, get body() { body(); throw new Error("private"); } };
    const request = vi.fn().mockResolvedValue(response);
    const error = await createConnect11PlainVideoFacade(config, request).admit(admission).catch((error) => error);
    expect(readConnect11PlainVideoTokenRefusal(error)).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it("bounds bytes and chunks, cancels oversized streams and releases locks", async () => {
    for (const mode of ["bytes", "header", "chunks"] as const) {
      const cancel = vi.fn().mockRejectedValue(new Error("secret cleanup"));
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(mode === "bytes" ? 4_097 : 0)); },
        cancel,
      });
      const response = new Response(body, { status: 402,
        ...(mode === "header" ? { headers: { "content-length": "4097" } } : {}) });
      expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(response))).toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    }
    const oversized = `${JSON.stringify({ error: { code: "http_error", message: "trial_expired" } })}${" ".repeat(4_096)}`;
    expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(new Response(oversized, { status: 402 })))).toBeUndefined();
  });

  it("recognizes a bounded streamed envelope only after the complete body", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ error: { code: "http_error", message: "trial_expired" } }));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.subarray(0, 25));
      controller.enqueue(bytes.subarray(25));
      controller.close();
    } });
    expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(new Response(body, { status: 402 }))))
      .toEqual({ category: "trial_expired", httpStatus: 402 });
    expect(body.locked).toBe(false);
    const unparseable = new Uint8Array([...bytes, 0xff]);
    expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(new Response(unparseable, { status: 402 })))).toBeUndefined();
  });

  it("bounds stalled reads by the request signal without waiting for cancellation", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    try {
      const pending = rejectedToken(new Response(body, { status: 402 }));
      await vi.waitFor(() => expect(body.locked).toBe(true));
      controller.abort(new Error("secret abort reason"));
      expect(readConnect11PlainVideoTokenRefusal(await pending)).toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally { timeout.mockRestore(); }
  });

  it("handles errored streams and hostile response getters without retained causes", async () => {
    const errored = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private stream")); } });
    expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(new Response(errored, { status: 402 })))).toBeUndefined();
    expect(errored.locked).toBe(false);
    for (const response of [
      { ok: false, get status() { throw new Error("private status"); } },
      { ok: false, status: 402, get body() { throw new Error("private body"); } },
      { ok: false, status: 402, body: { get getReader() { throw new Error("private reader"); } } },
    ]) {
      expect(readConnect11PlainVideoTokenRefusal(await rejectedToken(response as unknown as Response))).toBeUndefined();
    }
    const getter = vi.fn(() => { throw new Error("private metadata"); });
    expect(readConnect11PlainVideoTokenRefusal({ get category() { return getter(); } })).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it("uses isolated credentials and sends the exact three-field token body", async () => {
    const request = responses(capability, token);
    await expect(
      createConnect11PlainVideoFacade(config, request).admit(admission),
    ).resolves.toEqual(token);
    expect(request.mock.calls[0][1].headers.authorization).toBe("Bearer status-secret");
    expect(request.mock.calls[1][1].headers.authorization).toBe("Bearer join-secret");
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      meeting_id: "meeting_01",
      participant_id: "person_01",
      grant_profile: "interactive",
    });
    expect(request.mock.calls[1][1].body).toBe(
      '{"meeting_id":"meeting_01","participant_id":"person_01","grant_profile":"interactive"}',
    );
    expect(String(request.mock.calls[1][0])).toBe(
      "https://connect11.example/api/v1/realtime/plain-video/tokens",
    );
  });

  it("rejects client-shaped extras before a token or capability request", async () => {
    const request = responses(capability, token);
    await expect(
      createConnect11PlainVideoFacade(config, request).admit({
        ...admission,
        consent: { accepted: true },
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects malformed presentation names before any provider request", async () => {
    for (const displayName of ["  Member", "Bad\u202eName", "😀".repeat(70)]) {
      const request = responses(capability, token);
      await expect(createConnect11PlainVideoFacade(config, request).admit({
        ...admission, displayName,
      })).rejects.toThrow("unavailable");
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("fails closed for unavailable, malformed, or unsafe responses", async () => {
    const unavailable = createConnect11PlainVideoFacade(
      config,
      responses({ ...capability, available: false, unavailable_reasons: ["not_configured"] }),
    );
    await expect(unavailable.admit(admission)).rejects.toThrow("unavailable");
    for (const badToken of [
      { ...token, rtc_url: "https://media.example" },
      { ...token, expires_at: 1 },
      { ...token, unexpected: true },
    ]) {
      await expect(
        createConnect11PlainVideoFacade(config, responses(capability, badToken)).admit(admission),
      ).rejects.toThrow("unavailable");
    }
  });

  it("refuses non-HTTPS facade origins", () => {
    expect(() =>
      createConnect11PlainVideoFacade({ ...config, baseUrl: "http://connect11.example" }),
    ).toThrow("unavailable");
  });

  it("does not mint when readiness contradicts an isolation failure", async () => {
    const request = responses({
      ...capability,
      unavailable_reasons: ["issuer_isolation_unverified"],
    }, token);
    await expect(createConnect11PlainVideoFacade(config, request).admit(admission))
      .rejects.toThrow("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not expose malformed configuration or transport failures", async () => {
    expect(() =>
      createConnect11PlainVideoFacade({ ...config, baseUrl: "not a URL" }),
    ).toThrow("unavailable");
    await expect(
      createConnect11PlainVideoFacade(
        config,
        vi.fn().mockRejectedValue(new Error("network details")),
      ).capabilities(),
    ).rejects.toThrow("unavailable");
  });

  it("uses the strict opaque eviction contract and requires a bounded status read", async () => {
    const eviction = {
      eviction_id: "12345678-1234-4234-8234-123456789012",
      contract_version: "phone11-plain-video.v1",
      status: "pending",
      revoke_token_ts: Math.floor(Date.now() / 1_000),
      created_at: "2026-09-19T00:00:00.000Z",
      completed_at: null,
    };
    const request = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify(eviction), { status: 202 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({
        ...eviction,
        status: "completed",
        completed_at: "2026-09-19T00:01:00.000Z",
      }), { status: 200 }));
    const facade = createConnect11PlainVideoFacade(config, request);

    await expect(facade.requestEviction({
      meetingId: "meeting_01",
      participantId: "person_01",
    }, "plain_video_remove_0001")).resolves.toEqual(eviction);
    expect(String(request.mock.calls[0][0])).toBe(
      "https://connect11.example/api/v1/realtime/plain-video/evictions",
    );
    expect(request.mock.calls[0][1].method).toBe("POST");
    expect(request.mock.calls[0][1].headers["Idempotency-Key"]).toBe("plain_video_remove_0001");
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      meeting_id: "meeting_01",
      participant_id: "person_01",
    });

    await expect(facade.evictionStatus(eviction.eviction_id)).resolves.toMatchObject({
      status: "completed",
    });
    expect(String(request.mock.calls[1][0])).toBe(
      `https://connect11.example/api/v1/realtime/plain-video/evictions/${eviction.eviction_id}`,
    );
  });

  it("rejects non-202, malformed, or incomplete eviction acknowledgements", async () => {
    const response = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed" }), { status: 202 }),
    );
    const facade = createConnect11PlainVideoFacade(config, response);
    await expect(facade.requestEviction({
      meetingId: "meeting_01",
      participantId: "person_01",
    }, "plain_video_remove_0001")).rejects.toThrow("unavailable");
    expect(response).toHaveBeenCalledTimes(1);
  });
});
