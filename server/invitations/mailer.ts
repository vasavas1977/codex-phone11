import { readAuthConfig } from "../_core/phone11-auth";

export type InvitationMailer = {
  send(message: { email: string; workspaceName: string; url: string; idempotencyKey: string }): Promise<string | null>;
};

export type InvitationConfig = { enabled: boolean; origin?: string; mailer?: InvitationMailer };

const EMAIL = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
const URL_PATH = "/auth/accept-invitation";

export function invitationEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email) || /[\r\n]/.test(email)) throw new Error("Enter one valid email address");
  return email;
}

function sender(value: string | undefined): string {
  const input = value?.trim() ?? "";
  if (input.length > 320 || /[\r\n]/.test(input)) throw new Error("Invalid invitation sender");
  if (EMAIL.test(input)) return invitationEmail(input);
  const match = /^([A-Za-z0-9][A-Za-z0-9 ._-]{0,99}) <([^<>]+)>$/.exec(input);
  if (!match || !match[1].trim()) throw new Error("Invalid invitation sender");
  return `${match[1].trim()} <${invitationEmail(match[2])}>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function invitationURL(origin: string, token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid invitation token");
  const url = new URL(URL_PATH, origin);
  if (url.origin !== origin || url.pathname !== URL_PATH || url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Invalid invitation origin");
  }
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}

/** Explicitly off until sender, secret, trusted origin, and operator toggle agree. */
export function readInvitationConfig(env: Record<string, string | undefined> = process.env, request: typeof fetch = fetch): InvitationConfig {
  if (env.PHONE11_INVITATIONS_ENABLED !== "true") return { enabled: false };
  if (env.PHONE11_INVITATIONS_PROVIDER !== "resend") return { enabled: false };
  const apiKey = env.PHONE11_INVITATIONS_RESEND_API_KEY?.trim();
  if (!apiKey || apiKey.length > 256 || !apiKey.startsWith("re_") || /\s/.test(apiKey)) return { enabled: false };
  try {
    const from = sender(env.PHONE11_INVITATIONS_FROM);
    const auth = readAuthConfig(env);
    const requestedOrigin = env.PHONE11_INVITATIONS_ORIGIN?.trim();
    if (!requestedOrigin || !auth.trustedOrigins.includes(requestedOrigin)) return { enabled: false };
    const origin = new URL(requestedOrigin);
    if (origin.origin !== requestedOrigin || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") return { enabled: false };
    const mailer: InvitationMailer = {
      async send({ email, workspaceName, url, idempotencyKey }) {
        if (invitationEmail(email) !== email || !url.startsWith(`${requestedOrigin}${URL_PATH}#token=`)) throw new Error("Invalid invitation message");
        const response = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            from, to: [email], subject: `Join ${workspaceName} on Phone11`,
            text: `You have been invited to ${workspaceName} on Phone11. Open this link to accept:\n\n${url}\n\nThis link expires in 48 hours and can be used once.`,
            html: `<p>You have been invited to ${escapeHtml(workspaceName)} on Phone11.</p><p><a href="${escapeHtml(url)}">Accept invitation</a></p><p>This link expires in 48 hours and can be used once.</p>`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Invitation delivery failed");
        const body = await response.json() as { id?: unknown };
        return typeof body.id === "string" ? body.id : null;
      },
    };
    return { enabled: true, origin: requestedOrigin, mailer };
  } catch { return { enabled: false }; }
}
