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
  availableMeetings?: unknown; meetingGrant?: unknown; voicemailItems?: unknown;
  callHistory?: unknown; audioStatus?: number; audioType?: string; audioLength?: string;
  audioBytes?: Uint8Array } = {}) {
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
    if (url.pathname === "/api/trpc/pbx.voicemail.list") {
      assert.deepEqual(JSON.parse(url.searchParams.get("input") ?? ""),
        { json: { tenantId: overrides.tenantId ?? 9 } });
      return trpc(overrides.voicemailItems ?? []);
    }
    if (url.pathname === "/api/trpc/pbx.selfService.usage") {
      assert.deepEqual(JSON.parse(url.searchParams.get("input") ?? ""),
        { json: { tenantId: overrides.tenantId ?? 9, period: "month" } });
      return trpc(overrides.callHistory ?? { tenantId: overrides.tenantId ?? 9, calls: [] });
    }
    if (url.pathname === "/api/trpc/pbx.voicemail.markRead") {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { json: { tenantId: overrides.tenantId ?? 9, id: 4 } });
      return trpc({ success: true });
    }
    if (url.pathname === "/api/recordings/voicemail/4") {
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.cache, "no-store");
      const bytes = overrides.audioBytes ?? Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
      ]);
      if ((overrides.audioStatus ?? 200) !== 200)
        return new Response(null, { status: overrides.audioStatus });
      return new Response(bytes.slice().buffer as ArrayBuffer, { status: overrides.audioStatus ?? 200, headers: {
        "content-type": overrides.audioType ?? "audio/wav",
        ...(overrides.audioLength ? { "content-length": overrides.audioLength } : {}),
      } });
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
  const meetings = await provider.availableMeetings(session.revision);
  assert.deepEqual(meetings, [{ meetingId: "11111111-1111-4111-8111-111111111111" }]);
  const grant = await provider.joinMeeting(session.revision, meetings[0].meetingId);
  assert.deepEqual(grant, { url: "wss://room.example.test", token: "private-room-token",
    grantProfile: "interactive", expiresAt: grant.expiresAt });
  assert.equal(JSON.stringify(provider.currentSession()).includes(grant.token), false);
  assert.equal(paths.filter(path => path.endsWith("meetings.join")).length, 1);
  await provider.signOut();
  await assert.rejects(provider.joinMeeting(session.revision, meetings[0].meetingId));
});

test("desktop voicemail inbox exposes bounded personal metadata through the signed-in session", async () => {
  const { provider, paths } = harness({ voicemailItems: [{ id: 4, tenant_id: 9, caller_name: "Som-O",
    caller_number: "1020", duration_seconds: 23, status: "new", created_at: "2026-09-27T10:00:00.000Z" }] });
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.listVoicemail("stale-revision"));
  assert.deepEqual(await provider.listVoicemail(session.revision), [{ id: 4, callerName: "Som-O",
    callerNumber: "1020", durationSeconds: 23, status: "new", createdAt: "2026-09-27T10:00:00.000Z" }]);
  assert.equal(paths.filter(path => path.endsWith("pbx.voicemail.list")).length, 1);
  await provider.signOut();
  await assert.rejects(provider.listVoicemail(session.revision));
});

test("desktop voicemail rejects malformed or oversized inbox metadata", async () => {
  for (const voicemailItems of [
    [{ id: 0, tenant_id: 9, caller_name: "Som-O", caller_number: "1020", duration_seconds: 23,
      status: "new", created_at: "2026-09-27T10:00:00.000Z" }],
    [{ id: 4, tenant_id: 9, caller_name: "Som-O", caller_number: "1020", duration_seconds: 23,
      status: "deleted", created_at: "2026-09-27T10:00:00.000Z" }],
    Array.from({ length: 101 }, (_, index) => ({ id: index + 1, tenant_id: 9, caller_name: null,
      caller_number: "1020", duration_seconds: 23, status: "new", created_at: "2026-09-27T10:00:00.000Z" })),
  ]) {
    const { provider } = harness({ voicemailItems });
    const session = await provider.signIn("user@example.test", "login-secret");
    await assert.rejects(provider.listVoicemail(session.revision));
  }
});

test("desktop voicemail drops unsafe caller labels without hiding a valid message", async () => {
  const { provider } = harness({ voicemailItems: [{ id: 4, tenant_id: 9, caller_name: "\u202eSpoofed",
    caller_number: " 1020 ", duration_seconds: 0, status: "read",
    created_at: "2026-09-27T10:00:00.000Z" }] });
  const session = await provider.signIn("user@example.test", "login-secret");
  assert.deepEqual(await provider.listVoicemail(session.revision), [{ id: 4,
    callerName: null, callerNumber: "1020", durationSeconds: 0, status: "read",
    createdAt: "2026-09-27T10:00:00.000Z" }]);
});

test("desktop call history requests the selected tenant month and exposes safe bounded metadata", async () => {
  const { provider } = harness({ tenantId: 12, callHistory: { tenantId: 12, calls: [{ id: 71, direction: "inbound",
    caller_number: "+6621234567", callee_number: "3001", total_duration_seconds: 42,
    disposition: "answered", started_at: "2026-09-27T10:00:00.000Z",
    call_uuid: "private-call-id", recording_url: "https://private.invalid/audio?token=secret" }] } });
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.listCallHistory("stale-revision"));
  const calls = await provider.listCallHistory(session.revision);
  assert.deepEqual(calls, [{ id: 71, direction: "inbound", callerNumber: "+6621234567",
    calleeNumber: "3001", durationSeconds: 42, disposition: "answered",
    startedAt: "2026-09-27T10:00:00.000Z" }]);
  assert.equal(JSON.stringify(calls).includes("private-call-id"), false);
  assert.equal(JSON.stringify(calls).includes("private.invalid"), false);
  assert.equal(JSON.stringify(calls).includes("secret"), false);
});

test("desktop call history rejects malformed, unsafe, or oversized responses", async () => {
  for (const callHistory of [
    { tenantId: 10, calls: [] },
    { tenantId: 9, calls: [{ id: 0, direction: "inbound", total_duration_seconds: 3,
      disposition: null, started_at: "2026-09-27T10:00:00.000Z" }] },
    { tenantId: 9, calls: [{ id: 1, direction: "other", total_duration_seconds: 3,
      disposition: null, started_at: "2026-09-27T10:00:00.000Z" }] },
    { tenantId: 9, calls: [{ id: 1, direction: "inbound", total_duration_seconds: 3,
      disposition: "https://secret.invalid", started_at: "2026-09-27T10:00:00.000Z" }] },
    { tenantId: 9, calls: Array.from({ length: 51 }, (_, id) => ({ id: id + 1, direction: "inbound",
      total_duration_seconds: 3, disposition: null, started_at: "2026-09-27T10:00:00.000Z" })) },
  ]) {
    const { provider } = harness({ callHistory });
    const session = await provider.signIn("user@example.test", "login-secret");
    await assert.rejects(provider.listCallHistory(session.revision));
  }
});

test("desktop voicemail read mutation binds the selected tenant and session revision", async () => {
  const { provider } = harness({ tenantId: 12, voicemailItems: [{ id: 4, tenant_id: 12,
    caller_name: null, caller_number: null, duration_seconds: 0, status: "new",
    created_at: "2026-09-27T10:00:00.000Z" }] });
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.markVoicemailRead("stale-revision", 4));
  await assert.rejects(provider.markVoicemailRead(session.revision, 0));
  await provider.markVoicemailRead(session.revision, 4);
  await provider.signOut();
  await assert.rejects(provider.markVoicemailRead(session.revision, 4));
});

test("desktop voicemail read rejects old-server or foreign inbox data before mutation", async () => {
  for (const voicemailItems of [
    [{ id: 4, caller_name: null, caller_number: null, duration_seconds: 0, status: "new",
      created_at: "2026-09-27T10:00:00.000Z" }],
    [{ id: 5, tenant_id: 12, caller_name: null, caller_number: null, duration_seconds: 0, status: "new",
      created_at: "2026-09-27T10:00:00.000Z" }],
    [{ id: 4, tenant_id: 9, caller_name: null, caller_number: null, duration_seconds: 0, status: "new",
      created_at: "2026-09-27T10:00:00.000Z" }],
  ]) {
    const { provider, paths } = harness({ tenantId: 12, voicemailItems });
    const session = await provider.signIn("user@example.test", "login-secret");
    await assert.rejects(provider.markVoicemailRead(session.revision, 4));
    assert.equal(paths.some(path => path.endsWith("pbx.voicemail.markRead")), false);
  }
});

test("desktop voicemail read sends no mutation if sign-out changes the session during preflight", async () => {
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let mutations = 0;
  const provider = new AuthenticatedDesktopProvider({ origin: "http://127.0.0.1:3000",
    allowHttpLoopbackForTests: true, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/sign-in/email") return json({ success: true }, 200, { "set-auth-token": bearer });
      if (path === "/api/auth/me") return json({ user: { id: 7 } });
      if (path === "/api/trpc/phone.getConfig") return trpc({ configured: true, tenantId: 12,
        extension: { id: 41, number: "1020" }, sip: { username: "sip1020", password,
          domain: "sip.example.test", transport: "TLS" } });
      if (path === "/api/trpc/pbx.voicemail.list") { entered(); return pending; }
      if (path === "/api/trpc/pbx.voicemail.markRead") { mutations++; return trpc({ success: true }); }
      if (path === "/api/auth/sign-out") return json({ success: true });
      throw new Error(`Unexpected ${path}`);
    } });
  const session = await provider.signIn("user@example.test", "login-secret");
  const marking = provider.markVoicemailRead(session.revision, 4);
  await waiting;
  await provider.signOut();
  release(trpc([{ id: 4, tenant_id: 12, caller_name: null, caller_number: null,
    duration_seconds: 0, status: "new", created_at: "2026-09-27T10:00:00.000Z" }]));
  await assert.rejects(marking);
  assert.equal(mutations, 0);
});

test("desktop voicemail audio requires a fresh inbox match and returns only bounded WAV bytes", async () => {
  const { provider, paths } = harness({ tenantId: 12, voicemailItems: [{ id: 4, tenant_id: 12, caller_name: "Som-O",
    caller_number: "1020", duration_seconds: 23, status: "new", created_at: "2026-09-27T10:00:00.000Z" }] });
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.voicemailAudio("stale-revision", 4));
  const audio = await provider.voicemailAudio(session.revision, 4);
  assert.deepEqual(audio, { id: 4, mimeType: "audio/wav", bytes: Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
  ]) });
  assert.equal(JSON.stringify(audio).includes(bearer), false);
  assert.equal(paths.filter(path => path === "/api/recordings/voicemail/4").length, 1);
  await provider.signOut();
  await assert.rejects(provider.voicemailAudio(session.revision, 4));
});

test("desktop voicemail audio rejects foreign IDs before media fetch", async () => {
  const { provider, paths } = harness({ voicemailItems: [{ id: 5, tenant_id: 9, caller_name: null,
    caller_number: null, duration_seconds: 23, status: "new", created_at: "2026-09-27T10:00:00.000Z" }] });
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.voicemailAudio(session.revision, 4));
  assert.equal(paths.some(path => path.startsWith("/api/recordings/voicemail/")), false);
});

test("desktop voicemail audio rejects a row returned for another tenant before media fetch", async () => {
  const { provider, paths } = harness({ tenantId: 12, voicemailItems: [{ id: 4, tenant_id: 9,
    caller_name: null, caller_number: null, duration_seconds: 23, status: "new",
    created_at: "2026-09-27T10:00:00.000Z" }] });
  const session = await provider.signIn("user@example.test", "login-secret");
  await assert.rejects(provider.voicemailAudio(session.revision, 4));
  assert.equal(paths.some(path => path.startsWith("/api/recordings/voicemail/")), false);
});

test("desktop voicemail audio rejects redirects, wrong media types, and oversized bodies", async () => {
  for (const options of [
    { audioStatus: 302 },
    { audioType: "text/html" },
    { audioLength: String(20 * 1024 * 1024 + 1) },
    { audioLength: "13" },
    { audioLength: "12", audioBytes: new Uint8Array(20 * 1024 * 1024 + 1) },
    { audioBytes: new Uint8Array(20 * 1024 * 1024 + 1) },
    { audioBytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
  ]) {
    const { provider } = harness({ voicemailItems: [{ id: 4, tenant_id: 9, caller_name: null,
      caller_number: null, duration_seconds: 0, status: "read", created_at: "2026-09-27T10:00:00.000Z" }], ...options });
    const session = await provider.signIn("user@example.test", "login-secret");
    await assert.rejects(provider.voicemailAudio(session.revision, 4), error => {
      assert.equal(String(error).includes(bearer), false);
      return true;
    });
  }
});

test("desktop voicemail body read aborts and discards bytes when sign-out changes the session", async () => {
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let mediaSignal: AbortSignal | undefined;
  const provider = new AuthenticatedDesktopProvider({ origin: "http://127.0.0.1:3000",
    allowHttpLoopbackForTests: true, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/sign-in/email") return json({ success: true }, 200, { "set-auth-token": bearer });
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${bearer}`);
      if (path === "/api/auth/me") return json({ user: { id: 7 } });
      if (path === "/api/trpc/phone.getConfig") return trpc({ configured: true, tenantId: 9,
        extension: { id: 41, number: "1020" }, sip: { username: "sip1020", password,
          domain: "sip.example.test", transport: "TLS" } });
      if (path === "/api/trpc/pbx.voicemail.list") return trpc([{ id: 4, tenant_id: 9, caller_name: null,
        caller_number: null, duration_seconds: 0, status: "read", created_at: "2026-09-27T10:00:00.000Z" }]);
      if (path === "/api/recordings/voicemail/4") {
        mediaSignal = init?.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(Uint8Array.from([0x52, 0x49, 0x46, 0x46])); entered(); },
          pull() { return new Promise<void>(() => {}); },
        });
        return new Response(body, { headers: { "content-type": "audio/wav" } });
      }
      if (path === "/api/auth/sign-out") return json({ success: true });
      throw new Error(`Unexpected ${path}`);
    } });
  const session = await provider.signIn("user@example.test", "login-secret");
  const reading = provider.voicemailAudio(session.revision, 4);
  await waiting;
  await provider.signOut();
  await assert.rejects(reading);
  assert.equal(mediaSignal?.aborted, true);
  assert.equal(provider.currentSession(), null);
});

test("desktop voicemail timeout cannot return a RIFF prefix as a complete recording", async () => {
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let fireTimeout!: () => void;
  const provider = new AuthenticatedDesktopProvider({ origin: "http://127.0.0.1:3000",
    allowHttpLoopbackForTests: true, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/sign-in/email") return json({ success: true }, 200, { "set-auth-token": bearer });
      if (path === "/api/auth/me") return json({ user: { id: 7 } });
      if (path === "/api/trpc/phone.getConfig") return trpc({ configured: true, tenantId: 9,
        extension: { id: 41, number: "1020" }, sip: { username: "sip1020", password,
          domain: "sip.example.test", transport: "TLS" } });
      if (path === "/api/trpc/pbx.voicemail.list") return trpc([{ id: 4, tenant_id: 9,
        caller_name: null, caller_number: null, duration_seconds: 0, status: "read",
        created_at: "2026-09-27T10:00:00.000Z" }]);
      if (path === "/api/recordings/voicemail/4") {
        assert.equal(init?.redirect, "error");
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]));
          },
          pull() {
            entered(); fireTimeout();
            return new Promise<void>(() => {});
          },
        });
        return new Response(body, { headers: { "content-type": "audio/wav" } });
      }
      if (path === "/api/auth/sign-out") return json({ success: true });
      throw new Error(`Unexpected ${path}`);
    } });
  const session = await provider.signIn("user@example.test", "login-secret");
  const originalSetTimeout = globalThis.setTimeout;
  let heldTimer: ReturnType<typeof setTimeout> | undefined;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 30000) {
      fireTimeout = () => typeof callback === "function" && callback(...args);
      heldTimer = originalSetTimeout(() => undefined, 60000);
      return heldTimer;
    }
    return originalSetTimeout(callback as TimerHandler, delay, ...args);
  }) as typeof setTimeout;
  try {
    const reading = provider.voicemailAudio(session.revision, 4);
    await waiting;
    await assert.rejects(reading, error => {
      assert.equal(String(error).includes(bearer), false);
      return true;
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    if (heldTimer) clearTimeout(heldTimer);
  }
});

test("desktop meeting titles are bounded presentation data and never join authority", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const [title, expected] of [
    ["Government & SI Team", "Government & SI Team"],
    ["\u202eTeam", undefined],
    [" A channel ", undefined],
    ["x".repeat(101), undefined],
  ] as const) {
    const { provider } = harness({ availableMeetings: [{ meetingId: id, tenantId: 9, title }] });
    const session = await provider.signIn("user@example.test", "login-secret");
    assert.deepEqual(await provider.availableMeetings(session.revision), [
      { meetingId: id, ...(expected ? { title: expected } : {}) },
    ]);
  }
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
