import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { createPhone11Auth, handlePhone11CredentialSignIn, phone11AuthOptions, readAuthConfig, resolvePhone11User, revokePhone11Session, type Phone11Auth } from "../server/_core/phone11-auth";
import { registerAuthRoutes, phone11Cors } from "../server/_core/auth-routes";
import { applyAuthMigration, createExistingUserIdentity, restoreEmptyCanonicalUser } from "../server/_core/phone11-auth-admin";

const socket = process.env.PHONE11_AUTH_TEST_SOCKET;
const suite = socket?.includes("/phone11-auth-test-") ? describe : describe.skip;

suite("Phone11 explicit empty canonical user recovery", () => {
  let database: Pool;
  const input = { userId: 1, email: "owner@example.test", extension: "1001", confirmEmptyUsers: true };
  beforeAll(async () => {
    const admin = new Pool({ host: socket, database: "phone11_auth_test", user: "phone11_test" });
    await admin.query("CREATE SCHEMA recovery_test");
    await admin.end();
    database = new Pool({
      host: socket, database: "phone11_auth_test", user: "phone11_test",
      options: "-c search_path=recovery_test",
    });
    await database.query(
      'CREATE TABLE users (id SERIAL PRIMARY KEY, "openId" TEXT NOT NULL UNIQUE, name TEXT, email TEXT, "loginMethod" TEXT, role TEXT);' +
      "CREATE TABLE extensions (id SERIAL PRIMARY KEY, user_id INTEGER, extension_number TEXT, status TEXT, deleted_at TIMESTAMPTZ, sip_password TEXT);",
    );
  });
  beforeEach(async () => {
    await database.query("TRUNCATE users, extensions RESTART IDENTITY");
    await database.query("INSERT INTO extensions (user_id, extension_number, status, sip_password) VALUES (1, '1001', 'active', 'unchanged-test-value')");
  });
  afterAll(async () => { await database?.end(); });
  it("requires explicit confirmation", async () => {
    await expect(restoreEmptyCanonicalUser(database, { ...input, confirmEmptyUsers: false })).rejects.toThrow();
    expect((await database.query("SELECT * FROM users")).rowCount).toBe(0);
  });
  it("refuses a mismatched, deleted or ambiguous extension", async () => {
    await expect(restoreEmptyCanonicalUser(database, { ...input, userId: 2 })).rejects.toThrow("assignment");
    await database.query("UPDATE extensions SET deleted_at=NOW()");
    await expect(restoreEmptyCanonicalUser(database, input)).rejects.toThrow("assignment");
    await database.query("UPDATE extensions SET deleted_at=NULL");
    await database.query("INSERT INTO extensions (user_id, extension_number, status) VALUES (1,'1001','active')");
    await expect(restoreEmptyCanonicalUser(database, input)).rejects.toThrow("assignment");
    expect((await database.query("SELECT * FROM users")).rowCount).toBe(0);
  });
  it("restores only the approved user without elevating role or changing SIP credentials", async () => {
    const before = (await database.query("SELECT * FROM extensions")).rows;
    expect(await restoreEmptyCanonicalUser(database, input)).toEqual({ userId: 1 });
    const user = (await database.query("SELECT * FROM users")).rows[0];
    expect(user).toMatchObject({ id: 1, email: input.email, role: "user", loginMethod: "phone11" });
    expect(user.openId).toMatch(/^phone11:user:/);
    expect((await database.query("SELECT * FROM extensions")).rows).toEqual(before);
    const next = (await database.query('INSERT INTO users ("openId") VALUES ($1) RETURNING id', ["next-user"])).rows[0];
    expect(next.id).toBeGreaterThan(1);
  });
  it("rejects retries and any already populated canonical table", async () => {
    await restoreEmptyCanonicalUser(database, input);
    await expect(restoreEmptyCanonicalUser(database, input)).rejects.toThrow("not empty");
    expect((await database.query("SELECT * FROM users")).rowCount).toBe(1);
  });
});

suite("Phone11 auth: real PostgreSQL and HTTP", () => {
  let database: Pool;
  let server: Server;
  let auth: Phone11Auth;
  let baseURL: string;
  const password = randomBytes(24).toString("base64url");
  const secret = randomBytes(48).toString("base64url");
  const email = "owner@example.test";
  const audit = vi.spyOn(console, "info").mockImplementation(() => {});
  const passwordResetMailer = vi.fn(async (_message: { recipient: string; resetURL: string }) => undefined);
  const passwordResetDeliveryFailure = vi.fn();

  function requestAt(origin: string, path: string, init: RequestInit = {}) {
    // Native HTTP does not add browser Sec-Fetch metadata (Node fetch does).
    return new Promise<Response>((resolve, reject) => {
      const request = httpRequest(origin + path, {
        method: init.method || "GET", headers: Object.fromEntries(new Headers(init.headers)),
      }, response => {
        const parts: Buffer[] = [];
        response.on("data", part => parts.push(part));
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (let i = 0; i < response.rawHeaders.length; i += 2)
            headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          resolve(new Response(Buffer.concat(parts).toString(), { status: response.statusCode, headers }));
        });
      });
      request.on("error", reject);
      request.end(init.body || undefined);
    });
  }
  function request(path: string, init: RequestInit = {}) {
    return requestAt(baseURL, path, init);
  }
  function signIn(body = { email, password }, headers: Record<string, string> = {}) {
    return request("/api/auth/sign-in/email", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Phone11-Client": "native", ...headers },
      body: JSON.stringify({ ...body, rememberMe: false }),
    });
  }
  async function login() {
    const response = await signIn();
    expect(response.status).toBe(200);
    const token = response.headers.get("set-auth-token");
    expect(Boolean(token)).toBe(true);
    const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    return { token: token!, cookies };
  }
  async function issueResetToken(returnTo = "/portal") {
    const response = await request("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
      body: JSON.stringify({
        email,
        redirectTo: `http://localhost:8081/auth/reset-password?returnTo=${encodeURIComponent(returnTo)}`,
      }),
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(passwordResetMailer).toHaveBeenCalled());
    const call = passwordResetMailer.mock.calls.at(-1)?.[0];
    expect(call?.recipient).toBe(email);
    const link = new URL(call!.resetURL);
    const fragment = new URLSearchParams(link.hash.slice(1));
    return { fragment, link, token: fragment.get("token")! };
  }
  function resetPassword(token: string, newPassword: string) {
    return request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
      body: JSON.stringify({ newPassword, token }),
    });
  }
  async function peerAuthServer() {
    const peerDatabase = new Pool({ host: socket, database: "phone11_auth_test", user: "phone11_test" });
    const peerAuth = createPhone11Auth(peerDatabase, readAuthConfig(), {
      passwordResetMailer: { sendPasswordReset: passwordResetMailer },
    });
    const app = express();
    app.use(phone11Cors);
    registerAuthRoutes(app, { getAuth: () => peerAuth, getDatabase: () => peerDatabase });
    const peerServer = createServer(app);
    await new Promise<void>(resolve => peerServer.listen(0, "127.0.0.1", resolve));
    const address = peerServer.address();
    if (!address || typeof address === "string") throw new Error("Missing peer auth listener");
    return {
      database: peerDatabase,
      request: (path: string, init: RequestInit = {}) => requestAt(`http://127.0.0.1:${address.port}`, path, init),
      async close() {
        await new Promise<void>((resolve, reject) => peerServer.close(error => error ? reject(error) : resolve()));
        await peerDatabase.end();
      },
    };
  }
  async function waitForDatabaseWait(queryFragment: string) {
    await vi.waitFor(async () => {
      const result = await database.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND wait_event = 'advisory'
            AND position($1 in query) > 0`,
        [queryFragment],
      );
      expect(result.rows[0].count).toBeGreaterThan(0);
    }, { timeout: 3_000, interval: 20 });
  }

  beforeAll(async () => {
    database = new Pool({ host: socket, database: "phone11_auth_test", user: "phone11_test" });
    await database.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY, "openId" TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
        "loginMethod" TEXT, role TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(), "lastSignedIn" TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO users (id, "openId", name, email, "loginMethod", role) VALUES
        (17, 'original-owner-id', 'Owner', 'owner@example.test', 'legacy', 'admin'),
        (29, 'other-user-id', 'Other', 'other@example.test', 'legacy', 'user');
    `);
    const app = express();
    app.use(phone11Cors);
    registerAuthRoutes(app, { getAuth: () => auth, getDatabase: () => database });
    app.use(express.json());
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener");
    baseURL = "http://127.0.0.1:" + address.port;
    vi.stubEnv("PHONE11_AUTH_BASE_URL", baseURL);
    vi.stubEnv("PHONE11_AUTH_SECRET", secret);
    vi.stubEnv("PHONE11_AUTH_TRUSTED_ORIGINS", "http://localhost:8081,http://127.0.0.1:8089");
    const config = readAuthConfig();
    await applyAuthMigration(database, config);
    await applyAuthMigration(database, config);
    await createExistingUserIdentity(database, { userId: 17, email, password });
    auth = createPhone11Auth(database, config, {
      passwordResetMailer: { sendPasswordReset: passwordResetMailer },
      reportPasswordResetDeliveryFailure: passwordResetDeliveryFailure,
    });
  }, 30000);
  beforeEach(async () => {
    await database.query("DELETE FROM phone11_auth_rate_limit");
    passwordResetMailer.mockReset();
    passwordResetMailer.mockResolvedValue(undefined);
    passwordResetDeliveryFailure.mockReset();
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (database) await database.end();
    vi.unstubAllEnvs();
    audit.mockRestore();
  });

  it("publishes Phone11 auth capability without an OAuth app ID", async () => {
    const res = await request("/api/mobile/config");
    expect(await res.json()).toEqual({
      authProvider: "phone11",
      emailPasswordEnabled: true,
      passwordResetEnabled: true,
      passwordResetAvailability: "general",
      registrationEnabled: false,
    });
  });
  it("keeps password recovery disabled unless a mailer is explicitly configured", () => {
    expect(phone11AuthOptions(database, readAuthConfig()).emailAndPassword?.sendResetPassword).toBeUndefined();
  });
  it("preserves canonical user ID and role after password login", async () => {
    const { token } = await login();
    const res = await request("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
    expect(res.status).toBe(200);
    const { user } = await res.json();
    expect(user.id).toBe(17);
    expect(user.openId).toBe("original-owner-id");
    const resolved = await resolvePhone11User({ authorization: "Bearer " + token }, auth, database);
    expect(resolved.role).toBe("admin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.has("x-request-id")).toBe(true);
  });
  it("uses cookies for browser sessions without sharing a parent-domain cookie", async () => {
    const response = await signIn(undefined, { Origin: "http://localhost:8081" });
    expect(response.status).toBe(200);
    expect(response.headers.has("set-auth-token")).toBe(false);
    expect(response.headers.has("access-control-expose-headers")).toBe(false);
    expect(await response.json()).toEqual({ success: true });
    const setCookie = response.headers.getSetCookie();
    expect(setCookie.every(value => !value.toLowerCase().includes("domain="))).toBe(true);
    expect(setCookie.some(value => /httponly/i.test(value) && /samesite=lax/i.test(value))).toBe(true);
    const cookies = setCookie.map(value => value.split(";")[0]).join("; ");
    const me = await request("/api/auth/me", { headers: { Cookie: cookies } });
    expect(me.status).toBe(200);
    const invalidBearer = await request("/api/auth/me", {
      headers: { Cookie: cookies, Authorization: "Bearer invalid-token" },
    });
    expect(invalidBearer.status).toBe(401);
  });
  it("rejects wrong and unknown credentials without revealing which exists", async () => {
    const wrong = await signIn({ email, password: "this-is-the-wrong-password" });
    const unknown = await signIn({ email: "nobody@example.test", password });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).code).toBe((await unknown.json()).code);
  });
  it("rejects form-encoded credential sign-in before the auth handler and creates no session", async () => {
    const handler = vi.fn();
    const direct = await handlePhone11CredentialSignIn(new Request(
      "http://localhost/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password }),
      },
    ), { handler } as unknown as Phone11Auth, {} as Pool);
    expect(direct.status).toBe(415);
    expect(handler).not.toHaveBeenCalled();

    const sessionsBefore = Number((await database.query<{ count: string }>(
      'SELECT count(*) AS count FROM phone11_auth_session WHERE "userId" = (SELECT id FROM phone11_auth_user WHERE email = $1)',
      [email],
    )).rows[0].count);
    const response = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password }).toString(),
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("x-phone11-credential-serialization")).toBe("pg-advisory-v1");
    const sessionsAfter = Number((await database.query<{ count: string }>(
      'SELECT count(*) AS count FROM phone11_auth_session WHERE "userId" = (SELECT id FROM phone11_auth_user WHERE email = $1)',
      [email],
    )).rows[0].count);
    expect(sessionsAfter).toBe(sessionsBefore);
  });
  it("keeps password-reset requests uniform when an account is absent or configured delivery fails", async () => {
    const redirectTo = "http://localhost:8081/auth/reset-password?returnTo=%2Fportal";
    const resetRequest = (address: string) => request("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
      body: JSON.stringify({ email: address, redirectTo }),
    });
    passwordResetMailer.mockRejectedValueOnce(new Error("injected provider failure"));
    const existing = await resetRequest(email);
    const unknown = await resetRequest("absent@example.test");
    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await existing.json()).toEqual(await unknown.json());
    await vi.waitFor(() => expect(passwordResetDeliveryFailure).toHaveBeenCalledOnce());
  });
  it("uses an exact fragment-only callback, consumes one token and revokes every existing session", async () => {
    const active = await login();
    const issued = await issueResetToken();
    expect(issued.link.origin + issued.link.pathname).toBe("http://localhost:8081/auth/reset-password");
    expect(issued.link.searchParams.get("returnTo")).toBe("/portal");
    expect([...issued.link.searchParams.keys()]).toEqual(["returnTo"]);
    expect([...issued.fragment.keys()]).toEqual(["token"]);
    const token = issued.token;
    const newPassword = randomBytes(24).toString("base64url");
    const reset = await resetPassword(token, newPassword);
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ status: true });
    expect((await request("/api/auth/me", { headers: { Authorization: "Bearer " + active.token } })).status).toBe(401);
    const reuse = await resetPassword(token, password);
    expect(reuse.status).toBe(400);
    expect((await reuse.json()).code).toBe("INVALID_TOKEN");
    expect((await signIn({ email, password: newPassword })).status).toBe(200);

    const restoreToken = (await issueResetToken()).token;
    expect((await resetPassword(restoreToken, password)).status).toBe(200);
  });
  it("rolls back the password and token when durable session revocation fails", async () => {
    const active = await login();
    const token = (await issueResetToken()).token;
    const newPassword = randomBytes(24).toString("base64url");
    await database.query(`
      CREATE OR REPLACE FUNCTION phone11_test_fail_reset_session_delete()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected session revocation failure'; END;
      $$;
      CREATE TRIGGER phone11_test_fail_reset_session_delete
      BEFORE DELETE ON phone11_auth_session
      FOR EACH STATEMENT EXECUTE FUNCTION phone11_test_fail_reset_session_delete();
    `);
    try {
      const failedReset = await resetPassword(token, newPassword);
      expect(failedReset.status).toBe(503);
      expect(await failedReset.json()).toMatchObject({
        code: "PASSWORD_RESET_FAILED",
        message: "Password recovery is temporarily unavailable",
      });
      expect((await request("/api/auth/me", {
        headers: { Authorization: "Bearer " + active.token },
      })).status).toBe(200);
      expect((await signIn({ email, password })).status).toBe(200);
      expect((await signIn({ email, password: newPassword })).status).toBe(401);
    } finally {
      await database.query(`
        DROP TRIGGER IF EXISTS phone11_test_fail_reset_session_delete ON phone11_auth_session;
        DROP FUNCTION IF EXISTS phone11_test_fail_reset_session_delete();
      `);
    }

    // The same token still works after the injected failure, proving its
    // consumption and password change were rolled back with session deletion.
    expect((await resetPassword(token, newPassword)).status).toBe(200);
    expect((await signIn({ email, password: newPassword })).status).toBe(200);
    const restoreToken = (await issueResetToken()).token;
    expect((await resetPassword(restoreToken, password)).status).toBe(200);
  });
  it("allows exactly one concurrent reset for a token and revokes prior sessions", async () => {
    const active = await login();
    const token = (await issueResetToken()).token;
    const firstPassword = randomBytes(24).toString("base64url");
    const secondPassword = randomBytes(24).toString("base64url");
    const responses = await Promise.all([
      resetPassword(token, firstPassword),
      resetPassword(token, secondPassword),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    const rejected = responses.find(response => response.status === 400)!;
    expect((await rejected.json()).code).toBe("INVALID_TOKEN");

    const winningPassword = responses[0].status === 200 ? firstPassword : secondPassword;
    const losingPassword = responses[0].status === 200 ? secondPassword : firstPassword;
    expect((await request("/api/auth/me", {
      headers: { Authorization: "Bearer " + active.token },
    })).status).toBe(401);
    expect((await signIn({ email, password: winningPassword })).status).toBe(200);
    expect((await signIn({ email, password: losingPassword })).status).toBe(401);

    const restoreToken = (await issueResetToken()).token;
    expect((await resetPassword(restoreToken, password)).status).toBe(200);
  });
  it("serializes an old-password sign-in before reset and revokes its late session", async () => {
    const peer = await peerAuthServer();
    const blocker = await database.connect();
    const barrierKey = 1_000_000_000 + randomBytes(4).readUInt32BE() % 1_000_000_000;
    let barrierHeld = false;
    try {
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [barrierKey]);
      barrierHeld = true;
      await database.query(`
        CREATE OR REPLACE FUNCTION phone11_test_pause_session_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_lock(${barrierKey}::bigint);
          PERFORM pg_advisory_unlock(${barrierKey}::bigint);
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER phone11_test_pause_session_insert
        BEFORE INSERT ON phone11_auth_session
        FOR EACH ROW EXECUTE FUNCTION phone11_test_pause_session_insert();
      `);
      const token = (await issueResetToken()).token;
      const newPassword = randomBytes(24).toString("base64url");
      const signInPromise = signIn();
      await waitForDatabaseWait("phone11_auth_session");
      const resetPromise = peer.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
        body: JSON.stringify({ newPassword, token }),
      });
      await waitForDatabaseWait("hashtextextended");
      await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [barrierKey]);
      barrierHeld = false;

      const lateSignIn = await signInPromise;
      expect(lateSignIn.status).toBe(200);
      const lateToken = lateSignIn.headers.get("set-auth-token");
      expect(lateToken).toBeTruthy();
      expect((await resetPromise).status).toBe(200);
      expect((await request("/api/auth/me", {
        headers: { Authorization: "Bearer " + lateToken },
      })).status).toBe(401);
      expect((await signIn({ email, password: newPassword })).status).toBe(200);

      const restoreToken = (await issueResetToken()).token;
      expect((await resetPassword(restoreToken, password)).status).toBe(200);
    } finally {
      if (barrierHeld) await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [barrierKey]);
      blocker.release();
      await database.query(`
        DROP TRIGGER IF EXISTS phone11_test_pause_session_insert ON phone11_auth_session;
        DROP FUNCTION IF EXISTS phone11_test_pause_session_insert();
      `);
      await peer.close();
    }
  }, 15_000);
  it("makes a sign-in waiting behind reset verify only the committed new password", async () => {
    const active = await login();
    const peer = await peerAuthServer();
    const blocker = await database.connect();
    const barrierKey = 1_000_000_000 + randomBytes(4).readUInt32BE() % 1_000_000_000;
    let barrierHeld = false;
    try {
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [barrierKey]);
      barrierHeld = true;
      await database.query(`
        CREATE OR REPLACE FUNCTION phone11_test_pause_password_update()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_lock(${barrierKey}::bigint);
          PERFORM pg_advisory_unlock(${barrierKey}::bigint);
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER phone11_test_pause_password_update
        BEFORE UPDATE OF password ON phone11_auth_account
        FOR EACH ROW EXECUTE FUNCTION phone11_test_pause_password_update();
      `);
      const token = (await issueResetToken()).token;
      const newPassword = randomBytes(24).toString("base64url");
      const resetPromise = peer.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
        body: JSON.stringify({ newPassword, token }),
      });
      await waitForDatabaseWait("phone11_auth_account");
      const oldPasswordSignIn = signIn();
      await waitForDatabaseWait("hashtextextended");
      await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [barrierKey]);
      barrierHeld = false;

      expect((await resetPromise).status).toBe(200);
      expect((await oldPasswordSignIn).status).toBe(401);
      expect((await request("/api/auth/me", {
        headers: { Authorization: "Bearer " + active.token },
      })).status).toBe(401);
      expect((await signIn({ email, password: newPassword })).status).toBe(200);

      const restoreToken = (await issueResetToken()).token;
      expect((await resetPassword(restoreToken, password)).status).toBe(200);
    } finally {
      if (barrierHeld) await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [barrierKey]);
      blocker.release();
      await database.query(`
        DROP TRIGGER IF EXISTS phone11_test_pause_password_update ON phone11_auth_account;
        DROP FUNCTION IF EXISTS phone11_test_pause_password_update();
      `);
      await peer.close();
    }
  }, 15_000);
  it("fails a saturated credential-serialization queue closed within its bounded wait", async () => {
    const blocker = await database.connect();
    const authUserId = (await database.query<{ id: string }>(
      "SELECT id FROM phone11_auth_user WHERE email = $1",
      [email],
    )).rows[0].id;
    const sessionsBefore = Number((await database.query<{ count: string }>(
      'SELECT count(*) AS count FROM phone11_auth_session WHERE "userId" = $1',
      [authUserId],
    )).rows[0].count);
    let locked = false;
    try {
      await blocker.query(
        "SELECT pg_advisory_lock(hashtextextended($1::text, 11011::bigint))",
        [`phone11:credential:${authUserId}`],
      );
      locked = true;
      const startedAt = Date.now();
      const attempts = Array.from({ length: 18 }, () => signIn());
      await waitForDatabaseWait("hashtextextended");
      const responses = await Promise.all(attempts);
      expect(responses.every(response => response.status === 503)).toBe(true);
      expect(await responses[0].json()).toEqual({ error: "Phone11 sign-in is temporarily unavailable" });
      expect(Date.now() - startedAt).toBeLessThan(8_000);
      const sessionsAfter = Number((await database.query<{ count: string }>(
        'SELECT count(*) AS count FROM phone11_auth_session WHERE "userId" = $1',
        [authUserId],
      )).rows[0].count);
      expect(sessionsAfter).toBe(sessionsBefore);
    } finally {
      if (locked) {
        await blocker.query(
          "SELECT pg_advisory_unlock(hashtextextended($1::text, 11011::bigint))",
          [`phone11:credential:${authUserId}`],
        );
      }
      blocker.release();
    }
  }, 12_000);
  it("rejects callback drift and query-string reset tokens without sending mail", async () => {
    for (const redirectTo of [
      "https://attacker.example/auth/reset-password",
      "http://localhost:8081/other",
      "http://localhost:8081/auth/reset-password?returnTo=https%3A%2F%2Fattacker.example",
    ]) {
      const response = await request("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
        body: JSON.stringify({ email, redirectTo }),
      });
      expect(response.status).toBe(403);
    }
    expect(passwordResetMailer).not.toHaveBeenCalled();
    expect((await request("/api/auth/reset-password?token=url-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
      body: JSON.stringify({ newPassword: password }),
    })).status).toBe(400);
    expect((await request("/api/auth/reset-password/path-token?callbackURL=" + encodeURIComponent("http://localhost:8081/auth/reset-password"))).status).toBe(404);
  });
  it("does not accept legacy signed JWTs, URL tokens, public signup or session injection", async () => {
    const token = await new SignJWT({ openId: "original-owner-id", appId: "" })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    expect((await request("/api/auth/me", { headers: { Authorization: "Bearer " + token } })).status).toBe(401);
    expect((await request("/api/auth/me?sessionToken=" + token)).status).toBe(401);
    expect((await request("/api/oauth/mobile?code=test&state=test")).status).toBe(410);
    expect((await request("/api/auth/session", { method: "POST" })).status).toBe(410);
    expect((await request("/api/auth/sign-up/email", { method: "POST" })).status).toBe(404);
  });
  it("blocks untrusted browser origins, including sign-out CSRF", async () => {
    const { cookies } = await login();
    const response = await signIn(undefined, { Origin: "https://attacker.example" });
    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect((await request("/api/auth/sign-out", {
      method: "POST", headers: { Origin: "https://attacker.example", Cookie: cookies },
    })).status).toBe(403);
  });
  it("revokes the actual server session on sign-out", async () => {
    const { token } = await login();
    const headers = { Authorization: "Bearer " + token };
    expect((await request("/api/auth/sign-out", { method: "POST", headers })).status).toBe(200);
    expect((await request("/api/auth/me", { headers })).status).toBe(401);
  });
  it("does not claim successful sign-out when durable deletion fails", async () => {
    const { token } = await login();
    const headers = { authorization: "Bearer " + token };
    const originalQuery = database.query.bind(database);
    const failure = vi.spyOn(database, "query").mockImplementation(((sql: unknown, ...args: unknown[]) => {
      if (typeof sql === "string" && sql.startsWith("DELETE FROM phone11_auth_session")) {
        return Promise.reject(new Error("Injected database failure"));
      }
      return (originalQuery as Function)(sql, ...args);
    }) as typeof database.query);
    try {
      await expect(revokePhone11Session(headers, auth, database)).rejects.toThrow("Injected");
      expect((await request("/api/auth/sign-out", { method: "POST", headers })).status).toBe(503);
      expect((await request("/api/auth/me", { headers })).status).toBe(200);
    } finally { failure.mockRestore(); }
    expect((await request("/api/auth/sign-out", { method: "POST", headers })).status).toBe(200);
    expect((await request("/api/auth/me", { headers })).status).toBe(401);
  });
  it("blocks cookie logout without an Origin and strips bearer issuance for browser fetch metadata", async () => {
    const { cookies } = await login();
    expect((await request("/api/auth/sign-out", {
      method: "POST", headers: { Cookie: cookies },
    })).status).toBe(403);
    const response = await signIn(undefined, { "Sec-Fetch-Site": "same-origin" });
    expect(response.status).toBe(200);
    expect(response.headers.has("set-auth-token")).toBe(false);
    expect(await response.json()).toEqual({ success: true });
  });
  it("does not expose unused session and password mutation endpoints", async () => {
    const { cookies } = await login();
    for (const path of ["get-session", "list-sessions", "change-password", "revoke-session", "revoke-sessions"]) {
      const response = await request("/api/auth/" + path, {
        method: path.includes("password") || path.startsWith("revoke") ? "POST" : "GET",
        headers: { Cookie: cookies },
      });
      expect(response.status).toBe(404);
      expect(response.headers.has("set-auth-token")).toBe(false);
    }
  });
  it("exposes only the exact serialized credential sign-in route", async () => {
    const readOnlyProbe = await request("/api/auth/sign-in/email");
    expect(readOnlyProbe.status).toBe(404);
    expect(readOnlyProbe.headers.get("x-phone11-credential-serialization")).toBe("pg-advisory-v1");
    for (const path of [
      "/api/auth/sign-in/email/",
      "/api/auth/sign-in/username",
      "/api/auth/sign-in/phone-number",
      "/api/auth/sign-in/email-otp",
      "/api/auth/sign-in/social",
    ]) {
      const response = await request(path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      expect(response.status).toBe(404);
      expect(response.headers.has("set-auth-token")).toBe(false);
    }
  });
  it("rejects an expired session", async () => {
    const { token } = await login();
    await database.query('UPDATE phone11_auth_session SET "expiresAt" = NOW() - INTERVAL \'1 hour\'');
    expect((await request("/api/auth/me", { headers: { Authorization: "Bearer " + token } })).status).toBe(401);
  });
  it("rate-limits login even with spoofed forwarded IP headers", async () => {
    let status = 0;
    for (let i = 0; i < 6; i++) {
      status = (await signIn({ email, password: "wrong-password" }, {
        "x-forwarded-for": "192.0.2." + i, "x-phone11-client-ip": "198.51.100." + i,
      })).status;
    }
    expect(status).toBe(429);
  });
  it("refuses identity claiming, duplicate linking or password overwrite", async () => {
    await expect(createExistingUserIdentity(database, { userId: 29, email, password })).rejects.toThrow("must match");
    await expect(createExistingUserIdentity(database, { userId: 17, email, password })).rejects.toThrow("already exists");
    const result = await database.query("SELECT legacy_user_id FROM phone11_auth_identity");
    expect(result.rows.map(row => row.legacy_user_id)).toEqual([17]);
  });
  it("stores a password hash, and never puts passwords or session tokens in audit logs", async () => {
    const { token } = await login();
    const result = await database.query("SELECT password FROM phone11_auth_account");
    expect(result.rows[0].password === password).toBe(false);
    const logs = JSON.stringify(audit.mock.calls);
    expect(logs.includes(password)).toBe(false);
    expect(logs.includes(token)).toBe(false);
    expect(logs.includes(email)).toBe(false);
    expect(logs.includes("phone11.auth.request")).toBe(true);
  });
  it.skipIf(!process.env.PHONE11_AUTH_WEB_URL)("signs in and out through the rendered app on mobile and desktop", async () => {
    const webURL = process.env.PHONE11_AUTH_WEB_URL!;
    if (!webURL.startsWith("http://127.0.0.1:8089/")) throw new Error("Only the isolated local app is permitted");
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.PHONE11_PLAYWRIGHT_MODULE || "playwright");
    const browser = await chromium.launch({ headless: true });
    const output = process.env.PHONE11_AUTH_SCREENSHOTS || "/tmp/phone11-auth-browser-check";
    await mkdir(output, { recursive: true, mode: 0o700 });
    try {
      for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
        await database.query("DELETE FROM phone11_auth_rate_limit");
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        // Forward only auth requests to the real isolated PostgreSQL-backed auth server.
        await page.route("**/api/**", async (route: any) => {
          const url = new URL(route.request().url());
          if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/mobile/config") {
            const response = await route.fetch({ url: baseURL + url.pathname + url.search });
            await route.fulfill({ response });
          } else {
            await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Telephony is outside this auth-only test"}' });
          }
        });
        await page.goto(webURL);
        await page.getByLabel("Email", { exact: true }).waitFor();
        await page.getByLabel("Email", { exact: true }).fill(email);
        await page.getByLabel("Password", { exact: true }).fill("wrong-password");
        await page.getByRole("button", { name: "Sign In", exact: true }).click();
        await page.getByText("Email or password is incorrect. Please try again.").waitFor();
        await page.screenshot({ path: output + "/sign-in-" + viewport.width + ".png", fullPage: true });
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        expect(fits).toBe(true);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Sign In", exact: true }).click();
        await page.waitForURL((url: URL) => !url.pathname.startsWith("/auth/"));
        const id = await page.evaluate(async () => {
          const response = await fetch("/api/auth/me", { credentials: "include" });
          return (await response.json()).user?.id;
        });
        expect(id).toBe(17);
        await page.goto(webURL);
        await page.getByRole("button", { name: "Sign Out", exact: true }).click();
        await page.getByLabel("Email", { exact: true }).waitFor();
        const status = await page.evaluate(async () => (await fetch("/api/auth/me", { credentials: "include" })).status);
        expect(status).toBe(401);
        await context.close();
      }
    } finally { await browser.close(); }
  }, 120000);
  it("immediately denies a disabled mapping, including password reset, and refuses new sessions", async () => {
    const { token } = await login();
    const resetToken = (await issueResetToken()).token;
    await database.query("UPDATE phone11_auth_identity SET disabled_at = NOW() WHERE legacy_user_id = 17");
    expect((await request("/api/auth/me", { headers: { Authorization: "Bearer " + token } })).status).toBe(401);
    const disabledReset = await resetPassword(resetToken, randomBytes(24).toString("base64url"));
    expect(disabledReset.status).toBe(400);
    expect((await disabledReset.json()).code).toBe("INVALID_TOKEN");
    expect((await signIn()).status).toBe(401);
  });
});
