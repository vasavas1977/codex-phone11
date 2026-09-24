import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { postNativeCredential } from "../src/native-credential-request";
import { AuthenticatedDesktopProvider } from "../src/authenticated-provider";

test("native credential transport sends no browser metadata and keeps the bearer header", async () => {
  let observed: { method?: string; path?: string; origin?: string; mode?: string;
    site?: string; cookie?: string; client?: string; body: string } | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      observed = { method: request.method, path: request.url, origin: request.headers.origin,
        mode: request.headers["sec-fetch-mode"], site: request.headers["sec-fetch-site"],
        cookie: request.headers.cookie, client: request.headers["x-phone11-client"],
        body: Buffer.concat(chunks).toString("utf8") };
      response.writeHead(200, { "content-type": "application/json", "set-auth-token": "test-bearer" });
      response.end('{"success":true}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/api/auth/sign-in/email`;
    const response = await postNativeCredential(endpoint, '{"email":"test@example.invalid"}',
      new AbortController().signal, true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-auth-token"), "test-bearer");
    assert.equal(await response.text(), '{"success":true}');
    assert.deepEqual(observed, { method: "POST", path: "/api/auth/sign-in/email",
      origin: undefined, mode: undefined, site: undefined, cookie: undefined, client: "native",
      body: '{"email":"test@example.invalid"}' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("native credential transport refuses insecure remote origins", async () => {
  await assert.rejects(postNativeCredential("http://example.com/api/auth/sign-in/email", "{}",
    new AbortController().signal, true), /Invalid native credential endpoint/);
});

test("provider uses native transport for sign-in and bearer for protected lookup", async () => {
  let signInHeaders: Record<string, string | string[] | undefined> | undefined;
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url?.split("?")[0] ?? "");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/auth/sign-in/email") {
      signInHeaders = request.headers;
      response.setHeader("set-auth-token", "local-test-bearer");
      response.end('{"success":true}');
    } else if (request.url === "/api/auth/me") {
      assert.equal(request.headers.authorization, "Bearer local-test-bearer");
      response.end('{"user":{"id":7}}');
    } else if (request.url?.startsWith("/api/trpc/phone.getConfig?")) {
      assert.equal(request.headers.authorization, "Bearer local-test-bearer");
      response.end(JSON.stringify({ result: { data: { json: {
        configured: true, tenantId: 9, extension: { id: 41, number: "3001" },
        sip: { username: "sip3001", password: "local-test-sip-secret", domain: "sip.example.invalid",
          transport: "UDP" },
      } } } }));
    } else {
      response.writeHead(404);
      response.end('{}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const provider = new AuthenticatedDesktopProvider({ origin: `http://127.0.0.1:${address.port}`,
      allowHttpLoopbackForTests: true });
    const session = await provider.signIn("test@example.invalid", "test-password");
    assert.equal(session.userId, "7");
    assert.equal(provider.currentExtensionNumber(), "3001");
    assert.deepEqual(paths, ["/api/auth/sign-in/email", "/api/auth/me", "/api/trpc/phone.getConfig"]);
    assert.equal(signInHeaders?.origin, undefined);
    assert.equal(signInHeaders?.["sec-fetch-mode"], undefined);
    assert.equal(signInHeaders?.["x-phone11-client"], "native");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("native credential transport does not follow redirects", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(302, { Location: "/api/auth/sign-in/email" });
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await postNativeCredential(
      `http://127.0.0.1:${address.port}/api/auth/sign-in/email`, "{}",
      new AbortController().signal, true);
    assert.equal(response.status, 302);
    assert.equal(requests, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
