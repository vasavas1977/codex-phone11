import { randomUUID } from "node:crypto";
import type { Phone11PasswordResetMailer } from "./phone11-auth";

const RESET_PATH = "/auth/reset-password";
const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 10_000;
const EMAIL = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;

export type Phone11PasswordResetResendConfig = {
  apiKey: string;
  from: string;
  timeoutMs: number;
};

export type Phone11PasswordResetDelivery = {
  availability: "general";
  mailer: Phone11PasswordResetMailer;
};

function exactEmail(value: string | undefined, name: string): string {
  const normalized = value?.trim().toLowerCase() || "";
  if (normalized.length > 254 || !EMAIL.test(normalized) || /[\r\n]/.test(normalized)) {
    throw new Error(`${name} must be one email address`);
  }
  return normalized;
}

function exactFrom(value: string | undefined): string {
  const input = value?.trim() || "";
  if (input.length > 320 || /[\r\n]/.test(input)) {
    throw new Error("PHONE11_PASSWORD_RESET_FROM must be one sender");
  }
  if (EMAIL.test(input)) return exactEmail(input, "PHONE11_PASSWORD_RESET_FROM");
  const match = /^([A-Za-z0-9][A-Za-z0-9 ._-]{0,99}) <([^<>]+)>$/.exec(input);
  if (!match || !match[1].trim()) throw new Error("PHONE11_PASSWORD_RESET_FROM must be one sender");
  return `${match[1].trim()} <${exactEmail(match[2], "PHONE11_PASSWORD_RESET_FROM")}>`;
}

export function readPhone11PasswordResetResendConfig(
  env: Record<string, string | undefined> = process.env,
): Phone11PasswordResetResendConfig | undefined {
  const provider = env.PHONE11_PASSWORD_RESET_PROVIDER?.trim();
  const apiKey = env.PHONE11_PASSWORD_RESET_RESEND_API_KEY?.trim();
  const from = env.PHONE11_PASSWORD_RESET_FROM?.trim();
  if (!provider) {
    if (apiKey || from) {
      throw new Error("PHONE11_PASSWORD_RESET_PROVIDER is required when password recovery settings are present");
    }
    return undefined;
  }
  if (provider !== "resend") throw new Error("PHONE11_PASSWORD_RESET_PROVIDER must be resend");
  if (!apiKey || apiKey.length > 256 || !apiKey.startsWith("re_") || /\s/.test(apiKey)) {
    throw new Error("PHONE11_PASSWORD_RESET_RESEND_API_KEY is invalid");
  }
  return { apiKey, from: exactFrom(from), timeoutMs: DELIVERY_TIMEOUT_MS };
}

function validateResetURL(value: string): { token: string; url: URL } {
  if (value.length > 2048) throw new Error("Invalid password reset URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== RESET_PATH) {
    throw new Error("Invalid password reset URL");
  }
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.some(key => key !== "returnTo") || url.searchParams.getAll("returnTo").length > 1) {
    throw new Error("Invalid password reset URL");
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const tokens = fragment.getAll("token");
  if ([...fragment.keys()].some(key => key !== "token") || tokens.length !== 1 || !tokens[0] || tokens[0].length > 1024) {
    throw new Error("Invalid password reset URL");
  }
  return { token: tokens[0], url };
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function createPhone11PasswordResetResendMailer(
  config: Phone11PasswordResetResendConfig,
  request: typeof fetch = fetch,
): Phone11PasswordResetMailer {
  return {
    async sendPasswordReset({ recipient, resetURL }) {
      const to = exactEmail(recipient, "Password reset recipient");
      const validated = validateResetURL(resetURL);
      const url = validated.url.href;
      const idempotencyKey = `phone11-password-reset/${randomUUID()}`;
      try {
        const response = await request(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [to],
            subject: "Reset your Phone11 password",
            text: `Open this secure link to reset your Phone11 password:\n\n${url}\n\nThis link expires in 15 minutes and can be used once.`,
            html: `<p>Open this secure link to reset your Phone11 password:</p><p><a href="${html(url)}">Reset password</a></p><p>This link expires in 15 minutes and can be used once.</p>`,
          }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (!response.ok) throw new Error("Resend rejected password reset email");
      } catch {
        throw new Error("Password reset email delivery failed");
      }
    },
  };
}

export function createPhone11PasswordResetDeliveryFromEnv(
  env: Record<string, string | undefined> = process.env,
  request?: typeof fetch,
): Phone11PasswordResetDelivery | undefined {
  const config = readPhone11PasswordResetResendConfig(env);
  if (!config) return undefined;
  return { availability: "general", mailer: createPhone11PasswordResetResendMailer(config, request) };
}
