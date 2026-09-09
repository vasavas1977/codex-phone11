import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Pool } from "pg";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { getPool } from "../pbx/db";
import { ForbiddenError } from "../../shared/_core/errors";

export type Phone11AuthConfig = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
};

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

export function phone11AuthOptions(database: Pool, config: Phone11AuthConfig): BetterAuthOptions {
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
    verification: { modelName: "phone11_auth_verification" },
    rateLimit: {
      enabled: true, storage: "database", modelName: "phone11_auth_rate_limit",
      window: 60, max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      cookiePrefix: "phone11",
      useSecureCookies: config.baseURL.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-phone11-client-ip"] },
    },
    plugins: [bearer({ requireSignature: true })],
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

export function createPhone11Auth(database: Pool, config: Phone11AuthConfig) {
  return betterAuth(phone11AuthOptions(database, config));
}

export type Phone11Auth = ReturnType<typeof createPhone11Auth>;
let auth: Phone11Auth | undefined;

export function getPhone11Auth(): Phone11Auth {
  if (!auth) auth = createPhone11Auth(getPool(), readAuthConfig());
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
