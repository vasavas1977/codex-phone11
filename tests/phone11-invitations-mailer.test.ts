import { describe, expect, it, vi } from "vitest";
import { invitationURL, readInvitationConfig } from "../server/invitations/mailer";
const env = {
  NODE_ENV: "test", PHONE11_AUTH_SECRET: "fixture-secret-with-more-than-thirty-two-bytes",
  PHONE11_AUTH_TRUSTED_ORIGINS: "https://1toall.phone11.ai",
  PHONE11_INVITATIONS_ENABLED: "true", PHONE11_INVITATIONS_PROVIDER: "resend",
  PHONE11_INVITATIONS_RESEND_API_KEY: "re_fixture_only_not_a_real_key",
  PHONE11_INVITATIONS_FROM: "Phone11 <noreply@phone11.ai>",
  PHONE11_INVITATIONS_ORIGIN: "https://1toall.phone11.ai",
};
const token = "x".repeat(43);
const message = { email: "person@example.test", workspaceName: "Acme <script>", url: invitationURL(env.PHONE11_INVITATIONS_ORIGIN, token), idempotencyKey: "fixture-key" };

describe("Invitation email boundary", () => {
  it("stays disabled on absent, partial or untrusted configuration", () => {
    const request = vi.fn();
    expect(readInvitationConfig({}, request).enabled).toBe(false);
    for (const override of [
      { PHONE11_INVITATIONS_ORIGIN: "https://attacker.test" },
      { PHONE11_INVITATIONS_ORIGIN: "https://1toall.phone11.ai/path" },
      { PHONE11_INVITATIONS_RESEND_API_KEY: "" },
      { PHONE11_INVITATIONS_FROM: "Phone11 <noreply@phone11.ai>\r\nBcc: attacker@test.example" },
    ]) expect(readInvitationConfig({ ...env, ...override }, request).enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("sends the fixed fragment link, escapes workspace HTML and keeps retries idempotent", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "fixture-provider-id" }), { status: 200 }));
    const config = readInvitationConfig(env, request);
    expect(config.enabled).toBe(true);
    expect(await config.mailer!.send(message)).toBe("fixture-provider-id");
    const [endpoint, init] = request.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(init.headers["Idempotency-Key"]).toBe("fixture-key");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual([message.email]);
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<script>");
    expect(body.text).toContain("/auth/accept-invitation#token=");
    expect(body.text).not.toContain("?token=");
  });
  it("does not treat a provider rejection as sent or expose provider response", async () => {
    const request = vi.fn().mockResolvedValue(new Response("sensitive-provider-response", { status: 403 }));
    await expect(readInvitationConfig(env, request).mailer!.send(message)).rejects.toThrow("Invitation delivery failed");
  });
  it("rejects a changed recipient or destination before provider access", async () => {
    const request = vi.fn();
    const mailer = readInvitationConfig(env, request).mailer!;
    await expect(mailer.send({ ...message, email: "a@example.test,b@example.test" })).rejects.toThrow();
    await expect(mailer.send({ ...message, url: "https://attacker.test/auth/accept-invitation#token=abc" })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
