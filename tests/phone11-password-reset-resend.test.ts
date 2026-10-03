import { describe, expect, it, vi } from "vitest";
import type { Express, Request as ExpressRequest, RequestHandler, Response as ExpressResponse } from "express";
import type { Pool } from "pg";
import type { Phone11Auth } from "../server/_core/phone11-auth";
import { registerAuthRoutes } from "../server/_core/auth-routes";
import {
  createPhone11PasswordResetDeliveryFromEnv,
  createPhone11PasswordResetResendMailer,
  readPhone11PasswordResetResendConfig,
  type Phone11PasswordResetResendConfig,
} from "../server/_core/phone11-password-reset-resend";

const resetURL = "https://portal.phone11.ai/auth/reset-password?returnTo=%2Fportal#token=opaque-reset-token";
const config: Phone11PasswordResetResendConfig = {
  apiKey: "re_test_key_not_a_live_secret",
  from: "Phone11 <noreply@phone11.ai>",
  timeoutMs: 10_000,
};

describe("Phone11 Resend password-reset delivery", () => {
  it("is disabled by default and fails closed on partial or ambiguous configuration", () => {
    expect(createPhone11PasswordResetDeliveryFromEnv({})).toBeUndefined();
    expect(() => readPhone11PasswordResetResendConfig({
      PHONE11_PASSWORD_RESET_RESEND_API_KEY: "re_test",
    })).toThrow(/PROVIDER/);
    expect(() => readPhone11PasswordResetResendConfig({
      PHONE11_PASSWORD_RESET_PROVIDER: "smtp",
    })).toThrow(/resend/);
    expect(() => readPhone11PasswordResetResendConfig({
      PHONE11_PASSWORD_RESET_PROVIDER: "resend",
      PHONE11_PASSWORD_RESET_RESEND_API_KEY: "not-a-key",
      PHONE11_PASSWORD_RESET_FROM: "Phone11 <noreply@phone11.ai>",
    })).toThrow(/API_KEY/);
    expect(() => readPhone11PasswordResetResendConfig({
      PHONE11_PASSWORD_RESET_PROVIDER: "resend",
      PHONE11_PASSWORD_RESET_RESEND_API_KEY: "re_test",
      PHONE11_PASSWORD_RESET_FROM: "Phone11 <first@example.test>, second@example.test",
    })).toThrow(/one sender/);
  });

  it("posts one fixed Resend request with no token or email in headers", async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }));
    const mailer = createPhone11PasswordResetResendMailer(config, request as typeof fetch);
    await mailer.sendPasswordReset({ recipient: "OWNER@example.test", resetURL });
    expect(request).toHaveBeenCalledOnce();
    const [endpoint, init] = request.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_test_key_not_a_live_secret",
      "Content-Type": "application/json",
    });
    const headers = JSON.stringify(init?.headers);
    expect(headers).not.toContain("owner@example.test");
    expect(headers).not.toContain("opaque-reset-token");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"])
      .toMatch(/^phone11-password-reset\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const payload = JSON.parse(String(init?.body));
    expect(payload).toEqual({
      from: "Phone11 <noreply@phone11.ai>",
      to: ["owner@example.test"],
      subject: "Reset your Phone11 password",
      text: expect.stringContaining(resetURL),
      html: expect.stringContaining("#token=opaque-reset-token"),
    });
    expect(payload.html).toContain(`href="${resetURL}"`);
    expect(payload.html).not.toMatch(/<img\b|https:\/\/[^\"]*(?:track|click)/i);
  });

  it("uses one attempt and returns a generic error for provider failures", async () => {
    const request = vi.fn(async () => new Response("provider details", { status: 422 }));
    const mailer = createPhone11PasswordResetResendMailer(config, request as typeof fetch);
    await expect(mailer.sendPasswordReset({ recipient: "owner@example.test", resetURL }))
      .rejects.toThrow("Password reset email delivery failed");
    expect(request).toHaveBeenCalledOnce();
  });

  it("aborts a stalled request at the configured timeout", async () => {
    const request = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("provider timeout")), { once: true });
    }));
    const mailer = createPhone11PasswordResetResendMailer({ ...config, timeoutMs: 5 }, request as typeof fetch);
    await expect(mailer.sendPasswordReset({ recipient: "owner@example.test", resetURL }))
      .rejects.toThrow("Password reset email delivery failed");
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    "http://portal.phone11.ai/auth/reset-password#token=opaque-reset-token",
    "https://portal.phone11.ai/other#token=opaque-reset-token",
    "https://portal.phone11.ai/auth/reset-password?token=opaque-reset-token#token=opaque-reset-token",
    "https://portal.phone11.ai/auth/reset-password#token=one&token=two",
    "https://portal.phone11.ai/auth/reset-password#other=opaque-reset-token",
  ])("rejects malformed or leaking reset links before provider access: %s", async (badURL) => {
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    const mailer = createPhone11PasswordResetResendMailer(config, request as typeof fetch);
    await expect(mailer.sendPasswordReset({ recipient: "owner@example.test", resetURL: badURL }))
      .rejects.toThrow(/Invalid password reset URL/);
    expect(request).not.toHaveBeenCalled();
  });

  it("constructs only an explicitly configured general delivery", () => {
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    const delivery = createPhone11PasswordResetDeliveryFromEnv({
      PHONE11_PASSWORD_RESET_PROVIDER: "resend",
      PHONE11_PASSWORD_RESET_RESEND_API_KEY: "re_test_key_not_a_live_secret",
      PHONE11_PASSWORD_RESET_FROM: "Phone11 <noreply@phone11.ai>",
    }, request as typeof fetch);
    expect(delivery?.availability).toBe("general");
    expect(delivery?.mailer).toBeDefined();
  });

  it("returns service unavailable instead of fake success when delivery is disabled", async () => {
    let authHandler: RequestHandler | undefined;
    const app = {
      get() {}, use() {},
      all(path: string | string[], handler: RequestHandler) {
        if (path === "/api/auth/*") authHandler = handler;
      },
    } as unknown as Express;
    const database = { query: vi.fn() } as unknown as Pool;
    const auth = {} as Phone11Auth;
    registerAuthRoutes(app, { getAuth: () => auth, getDatabase: () => database });
    let status = 200;
    let body: unknown;
    const response = {
      status(value: number) { status = value; return response; },
      json(value: unknown) { body = value; return response; },
    } as unknown as ExpressResponse;
    await authHandler!({
      path: "/api/auth/request-password-reset", method: "POST", headers: {},
    } as ExpressRequest, response, vi.fn());
    expect(status).toBe(503);
    expect(body).toEqual({ error: "Password recovery is temporarily unavailable" });
  });
});
