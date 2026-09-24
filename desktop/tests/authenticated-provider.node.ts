import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthenticatedDesktopProvider, DesktopAuthenticationError } from "../src/authenticated-provider";

const bearer = "private-bearer-token";
const password = "private-sip-password";
const json = (value: unknown, status = 200, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(value), { status, headers });
const trpc = (value: unknown): Response => json({ result: { data: { json: value } } });

function harness(overrides: { authStatus?: number; authCode?: string; tenantId?: number; extension?: string;
  extensionId?: number; userId?: number; malformed?: boolean; rotatedPassword?: string;
  secondTenantId?: number; secondExtensionId?: number; secondUsername?: string;
  availableMeetings?: unknown; meetingGrant?: unknown } = {}) {
  const paths: string[] = [];
  let configCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === "/api/auth/sign-in/email") {
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("X-Phone11-Client"), "native");
      assert.equal(new Headers(init?.headers).has("Origin"), false);
      assert.equal(new Headers(init?.headers).has("Referer"), false);
      assert.equal(new Headers(init?.headers).has("sec-fetch-site"), false);
      assert.equal(JSON.parse(String(init?.body)).rememberMe, false);
      return json(overrides.authCode ? { code: overrides.authCode } : { success: true }, overrides.authStatus ?? 200,
        { "set-auth-token": bearer });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${bearer}`);
    if (url.pathname === "/api/auth/me") return json({ user: { id: overrides.userId ?? 7 } });
    if (url.pathname === "/api/trpc/phone.getConfig") {
      const subsequent = ++configCalls > 1;
      return trpc(overrides.malformed ? { configured: true } : {
      configured: true, tenantId: subsequent ? (overrides.secondTenantId ?? overrides.tenantId ?? 9) : (overrides.tenantId ?? 9),
      extension: { id: subsequent ? (overrides.secondExtensionId ?? overrides.extensionId ?? 41)
        : (overrides.extensionId ?? 41), number: overrides.extension ?? "1020" },
      sip: { username: subsequent ? (overrides.secondUsername ?? "sip1020") : "sip1020",
        password: subsequent && overrides.rotatedPassword
        ? overrides.rotatedPassword : password, domain: "sip.example.test", transport: "TLS" },
    });
    }
    if (url.pathname === "/api/trpc/meetings.availableForTenant") {
      assert.deepEqual(JSON.parse(url.searchParams.get("input") ?? ""), { json: { tenantId: overrides.tenantId ?? 9 } });
      return trpc(overrides.availableMeetings ?? [{ meetingId: "11111111-1111-4111-8111-111111111111", tenantId: overrides.tenantId ?? 9 }]);
    }
    if (url.pathname === "/api/trpc/meetings.join") {
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(init?.body)), { json: { meetingId: "11111111-1111-4111-8111-111111111111", tenantId: overrides.tenantId ?? 9 } });
      return trpc(overrides.meetingGrant ?? { url: "wss://room.example.test", token: "private-room-token",
        grant_profile: "interactive", expires_at: Math.floor(Date.now() / 1000) + 300 });
    }
    if (url.pathname === "/api/auth/sign-out") {
      assert.equal(new Headers(init?.headers).get("Origin"), "http://127.0.0.1:3000");
      return json({ success: true });
    }
    throw new Error("Unexpected endpoint");
  };
  return { provider: new AuthenticatedDesktopProvider({ origin: "http://127.0.0.1:3000", fetch: fetcher,
    allowHttpLoopbackForTests: true }), paths };
}

test("sign-in binds the own extension, and provisioning rechecks the grant", async () => {
  const { provider, paths } = harness();
  assert.equal(provider.currentExtensionNumber(), null);
  const session = await provider.signIn("user@example.test", "login-secret");
  assert.equal(provider.currentExtensionNumber(), "1020");
  assert.equal(Object.isFrozen(session), true);
  assert.deepEqual({ userId: session.userId, tenantId: session.tenantId,
    extensionId: session.extensionId }, { userId: "7", tenantId: 9, extensionId: 41 });
  assert.match(session.accountId, /^[a-f0-9]{64}$/);
  const secret = await provider.provision(session);
  assert.equal(Object.isFrozen(secret), true);
  assert.deepEqual(secret, { accountId: session.accountId, server: "sip.example.test",
    extension: "1020", authId: "sip1020", password, transport: "TLS" });
  assert.equal(paths.filter(path => path.endsWith("phone.getConfig")).length, 2);
  assert.equal(paths.some(path => path.includes("overview") || path.includes("memberships")), false);
  assert.equal(JSON.stringify(session).includes(password), false);
  assert.equal(JSON.stringify(session).includes(bearer), false);
});

test("auth rejection and malformed config fail closed without revealing credentials", async () => {
  for (const [options, code] of [[{ authStatus: 401 }, "credentials_rejected"],
    [{ authStatus: 403, authCode: "INVALID_ORIGIN" }, "origin_rejected"],
    [{ authStatus: 403, authCode: "EMAIL_NOT_VERIFIED" }, "email_unverified"],
    [{ authStatus: 403, authCode: "OTHER_BLOCK" }, "auth_blocked"],
    [{ malformed: true }, "phone_access_unavailable"]] as const) {
    const { provider } = harness(options);
    await assert.rejects(provider.signIn("user@example.test", "login-secret"), error => {
      assert.equal(error instanceof DesktopAuthenticationError && error.code, code);
      assert.equal(String(error).includes(password), false);
      assert.equal(String(error).includes(bearer), false);
      assert.equal(String(error).includes("login-secret"), false);
      return true;
    });
    assert.equal(provider.currentSession(), null);
  }
});

test("missing or malformed protected identity fails closed", async () => {
  for (const options of [{ extensionId: 0 }, { tenantId: 0 }, { extension: password }, { malformed: true }]) {
    const { provider } = harness(options);
    await assert.rejects(provider.signIn("user@example.test", "login-secret"));
    assert.equal(provider.currentSession(), null);
    assert.equal(provider.currentExtensionNumber(), null);
  }
});

test("changed SIP config requires a new sign-in before provisioning", async () => {
  for (const changed of [
    { rotatedPassword: "new-private-sip-password" },
    { secondTenantId: 10 },
    { secondExtensionId: 42 },
    { secondUsername: "another-account" },
  ]) {
    const { provider } = harness(changed);
    const session = await provider.signIn("user@example.test", "login-secret");
    assert.equal(provider.currentExtensionNumber(), "1020");
    await assert.rejects(provider.provision(session), error => {
      assert.equal(String(error).includes("new-private-sip-password"), false);
      return true;
    });
    assert.equal(provider.currentSession(), null);
    assert.equal(provider.currentExtensionNumber(), null);
  }
});

test("sign-out invalidates before a pending provisioning response completes", async () => {
  let release!: (response: Response) => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let meCalls = 0;
  const controlled = new AuthenticatedDesktopProvider({ origin: "http://localhost:3000", allowHttpLoopbackForTests: true,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/sign-in/email") return json({ success: true }, 200, { "set-auth-token": bearer });
      if (path === "/api/auth/me") {
        if (++meCalls === 2) { entered(); return pending; }
        return json({ user: { id: 7 } });
      }
      if (path === "/api/trpc/phone.getConfig") return trpc({ configured: true, tenantId: 9,
        extension: { id: 41, number: "1020" }, sip: { username: "sip1020", password,
          domain: "sip.example.test", transport: "TLS" } });
      if (path === "/api/auth/sign-out") return json({ success: true });
      throw new Error(`Unexpected ${path}`);
    },
  });
  const session = await controlled.signIn("user@example.test", "login-secret");
  assert.equal(controlled.currentExtensionNumber(), "1020");
  const provisioning = controlled.provision(session);
  await waiting;
  await controlled.signOut();
  assert.equal(controlled.currentExtensionNumber(), null);
  release(json({ user: { id: 7 } }));
  await assert.rejects(provisioning);
  assert.equal(controlled.currentSession(), null);
  await assert.rejects(controlled.provision(session));
});

test("non-HTTPS remote origins and URL credentials are rejected", () => {
  for (const origin of ["http://phone11.example", "https://user:secret@phone11.example", "https://phone11.example/path"]) {
    assert.throws(() => new AuthenticatedDesktopProvider({ origin }));
  }
});

test("desktop meetings use admitted IDs and keep media grants outside public session state", async () => {
  const { provider, paths } = harness();
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.availableMeetings("stale-revision"));
  const ids = await provider.availableMeetings(session.revision);
  assert.deepEqual(ids, ["11111111-1111-4111-8111-111111111111"]);
  const grant = await provider.joinMeeting(session.revision, ids[0]);
  assert.deepEqual(grant, { url: "wss://room.example.test", token: "private-room-token",
    grantProfile: "interactive", expiresAt: grant.expiresAt });
  assert.equal(JSON.stringify(provider.currentSession()).includes(grant.token), false);
  assert.equal(paths.filter(path => path.endsWith("meetings.join")).length, 1);
  await provider.signOut();
  await assert.rejects(provider.joinMeeting(session.revision, ids[0]));
});

test("desktop meeting admission rejects malformed, expired, and credential-bearing grants", async () => {
  for (const meetingGrant of [
    { url: "wss://user:secret@room.example.test", token: "private-room-token", grant_profile: "interactive", expires_at: Math.floor(Date.now() / 1000) + 300 },
    { url: "wss://room.example.test?token=private", token: "private-room-token", grant_profile: "interactive", expires_at: Math.floor(Date.now() / 1000) + 300 },
    { url: "wss://room.example.test", token: "private-room-token", grant_profile: "interactive", expires_at: Math.floor(Date.now() / 1000) - 1 },
    { url: "wss://room.example.test", token: "private-room-token", grant_profile: "host", expires_at: Math.floor(Date.now() / 1000) + 300 },
  ]) {
    const { provider } = harness({ meetingGrant });
    const session = await provider.signIn("user@example.test", "login-secret");
    await assert.rejects(provider.joinMeeting(session.revision, "11111111-1111-4111-8111-111111111111"));
  }
});

test("desktop meeting list rejects unexpected IDs, mismatched tenants, and oversized responses", async () => {
  for (const availableMeetings of [[{ meetingId: "other-tenant-title", tenantId: 9 }],
    [{ meetingId: "11111111-1111-4111-8111-111111111111", tenantId: 10 }],
    Array.from({ length: 101 }, () => ({ meetingId: "11111111-1111-4111-8111-111111111111", tenantId: 9 }))]) {
    const { provider } = harness({ availableMeetings });
    const session = await provider.signIn("user@example.test", "login-secret");
    await assert.rejects(provider.availableMeetings(session.revision));
  }
});

test("sign-out invalidates an in-flight desktop meeting grant before delivery", async () => {
  let entered!: () => void;
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const requestEntered = new Promise<void>(resolve => { entered = resolve; });
  const provider = new AuthenticatedDesktopProvider({ origin: "http://127.0.0.1:3000",
    allowHttpLoopbackForTests: true, fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/sign-in/email") return json({ success: true }, 200, { "set-auth-token": bearer });
      if (path === "/api/auth/me") return json({ user: { id: 7 } });
      if (path === "/api/trpc/phone.getConfig") return trpc({ configured: true, tenantId: 9,
        extension: { id: 41, number: "1020" }, sip: { username: "sip1020", password,
          domain: "sip.example.test", transport: "TLS" } });
      if (path === "/api/trpc/meetings.join") { entered(); return pending; }
      if (path === "/api/auth/sign-out") return json({ success: true });
      throw new Error(`Unexpected ${path}`);
    } });
  const session = await provider.signIn("user@example.test", "login-secret");
  const joining = provider.joinMeeting(session.revision, "11111111-1111-4111-8111-111111111111");
  await requestEntered;
  await provider.signOut();
  release(trpc({ url: "wss://room.example.test", token: "private-room-token",
    grant_profile: "interactive", expires_at: Math.floor(Date.now() / 1000) + 300 }));
  await assert.rejects(joining);
  assert.equal(provider.currentSession(), null);
});
