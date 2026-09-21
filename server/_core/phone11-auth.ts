import { createHash } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { bearer } from "better-auth/plugins/bearer";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Pool } from "pg";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { getPool } from "../pbx/db";
import { ForbiddenError } from "../../shared/_core/errors";
import { createPhone11PasswordResetDeliveryFromEnv } from "./phone11-password-reset-resend";

const PASSWORD_OPERATION_QUEUE_LIMIT = 16;
// Queue wait is shorter than the database lock wait, so queued requests fail
// without starting a second full lock-timeout window behind a stalled owner.
const PASSWORD_OPERATION_QUEUE_TIMEOUT_MS = 4_000;
const PASSWORD_OPERATION_LOCK_TIMEOUT = "5s";
const passwordOperationGates = new WeakMap<Pool, PasswordOperationGate>();

class PasswordOperationGate {
  private locked = false;
  private readonly waiters: Array<{
    active: boolean;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(this.releaseFunction());
    }
    if (this.waiters.length >= PASSWORD_OPERATION_QUEUE_LIMIT) {
      return Promise.reject(new Error("Password operation queue is full"));
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        active: true,
        resolve,
        reject,
        timer: setTimeout(() => {
          waiter.active = false;
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("Password operation queue timed out"));
        }, PASSWORD_OPERATION_QUEUE_TIMEOUT_MS),
      };
      this.waiters.push(waiter);
    });
  }

  private releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiters.length) {
        const next = this.waiters.shift()!;
        if (!next.active) continue;
        next.active = false;
        clearTimeout(next.timer);
        next.resolve(this.releaseFunction());
        return;
      }
      this.locked = false;
    };
  }
}

async function withPasswordOperationGate<T>(database: Pool, operation: () => Promise<T>): Promise<T> {
  let gate = passwordOperationGates.get(database);
  if (!gate) {
    gate = new PasswordOperationGate();
    passwordOperationGates.set(database, gate);
  }
  const release = await gate.acquire();
  try { return await operation(); } finally { release(); }
}

async function takeCredentialAdvisoryLock(client: import("pg").PoolClient, authUserId: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 11011::bigint))",
    [`phone11:credential:${authUserId}`],
  );
}

export type Phone11AuthConfig = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
};

const PASSWORD_RESET_PATH = "/auth/reset-password";
const passwordResetReturnPaths = new Set(["/portal", "/portal/dids", "/portal/usage", "/admin"]);
export const PHONE11_PASSWORD_RESET_TOKEN_SECONDS = 15 * 60;

export type Phone11PasswordResetMailer = {
  sendPasswordReset(message: { recipient: string; resetURL: string }): Promise<void>;
};

export type Phone11PasswordResetAvailability = "disabled" | "general";

export type Phone11AuthDependencies = {
  passwordResetMailer?: Phone11PasswordResetMailer;
  passwordResetAvailability?: Exclude<Phone11PasswordResetAvailability, "disabled">;
  reportPasswordResetDeliveryFailure?: () => void;
};

function invalidResetToken(): APIError {
  return APIError.fromStatus("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid reset token" });
}

// Better Auth 1.7.3 resets the credential before it deletes sessions. Execute
// those state changes together so a revocation failure cannot leave the new
// password active alongside sessions authenticated with the previous one.
async function resetPhone11PasswordAtomically(
  database: Pool,
  input: { token: unknown; newPassword: unknown },
): Promise<void> {
  const { token, newPassword } = input;
  if (typeof token !== "string" || !token || token.length > 1024) throw invalidResetToken();
  if (typeof newPassword !== "string" || newPassword.length < 12) {
    throw APIError.fromStatus("BAD_REQUEST", { code: "PASSWORD_TOO_SHORT", message: "Password is too short" });
  }
  if (newPassword.length > 128) {
    throw APIError.fromStatus("BAD_REQUEST", { code: "PASSWORD_TOO_LONG", message: "Password is too long" });
  }

  // Hash before opening the transaction so the credential and user rows stay
  // locked only for the short database mutation window.
  const password = await hashPassword(newPassword);
  const identifier = createHash("sha256").update(`reset-password:${token}`).digest("base64url");
  try {
    await withPasswordOperationGate(database, async () => {
      const client = await database.connect();
      let discardClient: Error | undefined;
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL lock_timeout = '${PASSWORD_OPERATION_LOCK_TIMEOUT}'`);
        const verification = await client.query<{ value: string; expiresAt: Date }>(
          `DELETE FROM phone11_auth_verification
            WHERE identifier = $1
          RETURNING value, "expiresAt"`,
          [identifier],
        );
        if (verification.rowCount !== 1 || verification.rows[0].expiresAt.getTime() < Date.now()) {
          throw invalidResetToken();
        }
        const userId = verification.rows[0].value;
        await takeCredentialAdvisoryLock(client, userId);
        const identity = await client.query(
          `SELECT u.id
             FROM phone11_auth_user u
             JOIN phone11_auth_identity i ON i.auth_user_id = u.id
            WHERE u.id = $1 AND i.disabled_at IS NULL
            FOR UPDATE OF u, i`,
          [userId],
        );
        if (identity.rowCount !== 1) throw invalidResetToken();
        const credential = await client.query(
          `UPDATE phone11_auth_account
              SET password = $2, "updatedAt" = NOW()
            WHERE "userId" = $1 AND "accountId" = $1 AND "providerId" = 'credential'
          RETURNING id`,
          [userId, password],
        );
        if (credential.rowCount !== 1) throw new Error("Password reset credential mapping is not exact");
        await client.query('DELETE FROM phone11_auth_session WHERE "userId" = $1', [userId]);
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {
          discardClient = new Error("Password reset rollback failed");
        }
        if (discardClient) throw discardClient;
        throw error;
      } finally {
        client.release(discardClient);
      }
    });
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw APIError.fromStatus("SERVICE_UNAVAILABLE", {
      code: "PASSWORD_RESET_FAILED",
      message: "Password recovery is temporarily unavailable",
    });
  }
}

export function validatePhone11PasswordResetRedirect(value: unknown, config: Phone11AuthConfig): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid password reset redirect");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid password reset redirect"); }
  if (!config.trustedOrigins.includes(url.origin)
    || url.pathname !== PASSWORD_RESET_PATH
    || url.username || url.password || url.hash) {
    throw new Error("Invalid password reset redirect");
  }
  const parameters = [...url.searchParams.keys()];
  if (parameters.some(key => key !== "returnTo") || url.searchParams.getAll("returnTo").length > 1) {
    throw new Error("Invalid password reset redirect");
  }
  const returnTo = url.searchParams.get("returnTo");
  if (returnTo !== null && !passwordResetReturnPaths.has(returnTo)) {
    throw new Error("Invalid password reset redirect");
  }
  return url.href;
}

export function readAuthConfig(env: Record<string, string | undefined> = process.env): Phone11AuthConfig {
  const base = new URL(env.PHONE11_AUTH_BASE_URL || "https://api.phone11.ai");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.hostname.includes("*") || base.username || base.password || base.search || base.hash || base.pathname !== "/" ||
      (base.protocol !== "https:" && !(env.NODE_ENV !== "production" && loopback && base.protocol === "http:"))) {
    throw new Error("PHONE11_AUTH_BASE_URL must be an HTTPS origin (HTTP loopback in development only)");
  }
  const secret = env.PHONE11_AUTH_SECRET || "";
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("PHONE11_AUTH_SECRET must be a new random secret of at least 32 bytes");
  }
  const origins = [base.origin, ...(env.PHONE11_AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean)]
    .map((value) => {
      const url = new URL(value.trim());
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.hostname.includes("*") || url.origin !== value.trim() || url.username || url.password ||
          (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && local && url.protocol === "http:"))) {
        throw new Error("PHONE11_AUTH_TRUSTED_ORIGINS must contain exact HTTPS origins");
      }
      return url.origin;
    });
  return { baseURL: base.origin, secret, trustedOrigins: [...new Set(origins)] };
}

export function phone11AuthOptions(
  database: Pool,
  config: Phone11AuthConfig,
  dependencies: Phone11AuthDependencies = {},
): BetterAuthOptions {
  const sendResetPassword = dependencies.passwordResetMailer
    ? async (data: { user: { email: string }; url: string; token: string }) => {
      // Delivery is detached from the HTTP response. Unknown accounts perform
      // the same token/verification work inside Better Auth, while a slow mail
      // provider cannot become an account-existence timing oracle.
      void Promise.resolve().then(async () => {
        try {
          const generated = new URL(data.url);
          const expectedPath = `/api/auth/reset-password/${encodeURIComponent(data.token)}`;
          if (generated.origin !== config.baseURL || generated.pathname !== expectedPath
            || generated.username || generated.password || generated.hash
            || [...generated.searchParams.keys()].some(key => key !== "callbackURL")
            || generated.searchParams.getAll("callbackURL").length !== 1) {
            throw new Error("Invalid generated password reset URL");
          }
          const callback = new URL(validatePhone11PasswordResetRedirect(
            generated.searchParams.get("callbackURL"), config,
          ));
          callback.hash = new URLSearchParams({ token: data.token }).toString();
          await dependencies.passwordResetMailer!.sendPasswordReset({
            recipient: data.user.email,
            resetURL: callback.href,
          });
        } catch {
          if (dependencies.reportPasswordResetDeliveryFailure) {
            dependencies.reportPasswordResetDeliveryFailure();
          } else {
            console.error(JSON.stringify({ event: "phone11.auth.password-reset.delivery.failed" }));
          }
        }
      });
    }
    : undefined;
  return {
    appName: "Phone11",
    baseURL: config.baseURL,
    basePath: "/api/auth",
    secret: config.secret,
    database,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: PHONE11_PASSWORD_RESET_TOKEN_SECONDS,
      ...(sendResetPassword ? { sendResetPassword } : {}),
    },
    user: {
      modelName: "phone11_auth_user",
      changeEmail: { enabled: false }, deleteUser: { enabled: false },
    },
    account: { modelName: "phone11_auth_account", accountLinking: { enabled: false } },
    session: {
      modelName: "phone11_auth_session",
      expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    verification: { modelName: "phone11_auth_verification", storeIdentifier: "hashed" },
    rateLimit: {
      enabled: true, storage: "database", modelName: "phone11_auth_rate_limit",
      window: 60, max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/reset-password": { window: 5 * 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "phone11",
      useSecureCookies: config.baseURL.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-phone11-client-ip"] },
    },
    plugins: [bearer({ requireSignature: true })],
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === "/request-password-reset") {
        try {
          ctx.body.redirectTo = validatePhone11PasswordResetRedirect(ctx.body.redirectTo, config);
        } catch {
          throw APIError.fromStatus("FORBIDDEN", { code: "INVALID_REDIRECT_URL", message: "Invalid redirect URL" });
        }
      }
      if (ctx.path === "/reset-password") {
        if (ctx.query?.token !== undefined) {
          throw APIError.fromStatus("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Reset token must be sent in the request body" });
        }
        await resetPhone11PasswordAtomically(database, {
          token: ctx.body?.token,
          newPassword: ctx.body?.newPassword,
        });
        return ctx.json({ status: true });
      }
    }) },
    databaseHooks: {
      session: { create: { before: async (session) => {
        const mapping = await database.query(
          "SELECT 1 FROM phone11_auth_identity WHERE auth_user_id = $1 AND disabled_at IS NULL",
          [session.userId],
        );
        if (!mapping.rows.length) {
          throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
        }
        return { data: session };
      } } },
    },
    telemetry: { enabled: false },
    // Request-level audit records are emitted without credentials or provider payloads.
    logger: { disabled: true },
  };
}

export function createPhone11Auth(
  database: Pool,
  config: Phone11AuthConfig,
  dependencies: Phone11AuthDependencies = {},
) {
  const service = betterAuth(phone11AuthOptions(database, config, dependencies));
  passwordResetAvailability.set(service, dependencies.passwordResetMailer
    ? dependencies.passwordResetAvailability || "general"
    : "disabled");
  return service;
}

export type Phone11Auth = ReturnType<typeof createPhone11Auth>;
const passwordResetAvailability = new WeakMap<object, Phone11PasswordResetAvailability>();
let auth: Phone11Auth | undefined;

async function credentialSignInLockKey(
  request: globalThis.Request,
  database: Pool,
): Promise<string | undefined> {
  let body: unknown;
  try { body = await request.clone().json(); } catch { return undefined; }
  if (!body || typeof body !== "object" || typeof (body as { email?: unknown }).email !== "string") {
    return undefined;
  }
  const email = (body as { email: string }).email.toLowerCase();
  if (!email || email.length > 320 || /[\x00-\x1f\x7f]/.test(email)) return undefined;
  const result = await database.query<{ id: string }>(
    'SELECT id FROM phone11_auth_user WHERE email = $1 ORDER BY id LIMIT 2',
    [email],
  );
  if (result.rowCount && result.rowCount > 1) {
    throw new Error("Credential sign-in identity is ambiguous");
  }
  return result.rows[0]?.id || `absent:${createHash("sha256").update(email).digest("base64url")}`;
}

/**
 * Serialize password verification through session insertion with password
 * reset. The candidate must own the exact credential sign-in route before
 * recovery is exposed; older unguarded sign-in workers must be drained first.
 */
export async function handlePhone11CredentialSignIn(
  request: globalThis.Request,
  authService: Phone11Auth = getPhone11Auth(),
  database: Pool = getPool(),
): Promise<globalThis.Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return new globalThis.Response(JSON.stringify({ error: "Unsupported media type" }), {
      status: 415,
      headers: { "Content-Type": "application/json" },
    });
  }
  const authUserId = await credentialSignInLockKey(request, database);
  // Malformed bodies cannot create a session; preserve Better Auth's schema
  // response while every body that can reach credential verification is locked.
  if (!authUserId) return authService.handler(request);
  if ((database.options.max ?? 10) < 2) {
    throw new Error("Credential serialization requires at least two database connections");
  }
  return withPasswordOperationGate(database, async () => {
    const client = await database.connect();
    let discardClient: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${PASSWORD_OPERATION_LOCK_TIMEOUT}'`);
      await takeCredentialAdvisoryLock(client, authUserId);
      const response = await authService.handler(request);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {
        discardClient = new Error("Credential serialization rollback failed");
      }
      if (discardClient) throw discardClient;
      throw error;
    } finally {
      client.release(discardClient);
    }
  });
}

export function getPhone11PasswordResetAvailability(
  authService: Phone11Auth = getPhone11Auth(),
): Phone11PasswordResetAvailability {
  return passwordResetAvailability.get(authService) || "disabled";
}

export function getPhone11Auth(): Phone11Auth {
  if (!auth) {
    const delivery = createPhone11PasswordResetDeliveryFromEnv();
    auth = createPhone11Auth(getPool(), readAuthConfig(), delivery ? {
      passwordResetMailer: delivery.mailer,
      passwordResetAvailability: delivery.availability,
    } : {});
  }
  return auth;
}

// A supplied bearer token never falls back to a different browser identity.
export function sessionHeaders(headers: Request["headers"]): Headers {
  const result = fromNodeHeaders(headers);
  if (result.has("authorization")) result.delete("cookie");
  return result;
}

export async function resolvePhone11User(
  headers: Request["headers"],
  authService: Phone11Auth = getPhone11Auth(),
  database: Pool = getPool(),
): Promise<User> {
  const session = await authService.api.getSession({
    headers: sessionHeaders(headers), query: { disableCookieCache: true },
  });
  if (!session) throw ForbiddenError("Not authenticated");
  // Explicit operator-approved identity mapping, never an email match or a guessed user ID.
  const result = await database.query<User>(
    `SELECT u.id, u."openId", u.name, u.email, u."loginMethod", u.role,
            u."createdAt", u."updatedAt", u."lastSignedIn"
       FROM phone11_auth_identity i JOIN users u ON u.id = i.legacy_user_id
      WHERE i.auth_user_id = $1 AND i.disabled_at IS NULL LIMIT 1`,
    [session.user.id],
  );
  if (!result.rows[0]) throw ForbiddenError("Account is not enabled for Phone11");
  return result.rows[0];
}

export async function revokePhone11Session(
  headers: Request["headers"],
  authService: Phone11Auth = getPhone11Auth(),
  database: Pool = getPool(),
) {
  const requestHeaders = sessionHeaders(headers);
  if (requestHeaders.has("cookie")) {
    const origin = requestHeaders.get("origin");
    const origins = authService.options.trustedOrigins;
    if (!origin || !Array.isArray(origins) || !origins.includes(origin)) {
      throw ForbiddenError("Origin not allowed");
    }
  }
  const current = await authService.api.getSession({
    headers: requestHeaders, query: { disableCookieCache: true, disableRefresh: true },
  });
  // Better Auth 1.7.3 swallows sign-out DELETE errors. Revoke durably before clearing client cookies.
  if (current) {
    await database.query(
      "DELETE FROM phone11_auth_session WHERE id = $1 AND token = $2",
      [current.session.id, current.session.token],
    );
    const remaining = await database.query("SELECT 1 FROM phone11_auth_session WHERE id = $1", [current.session.id]);
    if (remaining.rows.length) throw new Error("Session revocation did not persist");
  }
  return authService.api.signOut({ headers: requestHeaders, asResponse: true });
}
