/**
 * Align synthetic extension 7101 in the owned local PBX with the credential
 * returned by the commissioned Android staging API. Secrets stay in memory or
 * private mode-0600 lab files and are never included in output or evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { parse } from "dotenv";
import superjson from "superjson";
import { configs, validateRuntime, validateState } from "./fixture.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const privateDir = path.join(root, ".lab/private");
const migratorEnvPath = path.join(privateDir, "phone11-stage-migrator.env");
const apiEnvPath = path.join(privateDir, "android-staging-api.env");
const loginPasswordPath = path.join(
  privateDir,
  "phone11-stage-pilot-login-password",
);
const metadataPath = path.join(root, ".lab/fixture.json");
const evidencePath = path.join(root, ".lab/staging-fixture-alignment.json");
const expected = {
  api: "https://phone11-android-staging-api-413228367517.asia-southeast1.run.app",
  domain: "sip.stage.phone11.test",
  extension: "7101",
  port: 15060,
  transport: "UDP",
};
const ensure = (value, message) => {
  if (!value) throw new Error(message);
};
const privateFile = (file) => {
  const stat = fs.statSync(file);
  ensure(
    stat.isFile() && (stat.mode & 0o077) === 0,
    "Required private file permissions are unsafe",
  );
  return fs.readFileSync(file, "utf8");
};
const writePrivate = (file, value) => {
  fs.writeFileSync(file, value, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};
const docker = (args) =>
  execFileSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
let phase = "preflight";
function nativeFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      new URL(url),
      {
        method: init.method || "GET",
        headers: Object.fromEntries(new Headers(init.headers)),
      },
      (response) => {
        const parts = [];
        response.on("data", (part) => parts.push(part));
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (let i = 0; i < response.rawHeaders.length; i += 2)
            headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          resolve(
            new Response(Buffer.concat(parts), {
              status: response.statusCode,
              headers,
            }),
          );
        });
      },
    );
    request.setTimeout(15000, () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end(init.body || undefined);
  });
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      "Prepared only. Pass --execute to align the owned synthetic fixture from the commissioned staging API.",
    );
    return;
  }
  process.chdir(root);
  phase = "private-config";
  const migrationEnv = parse(privateFile(migratorEnvPath));
  const apiEnv = parse(privateFile(apiEnvPath));
  const loginPassword = privateFile(loginPasswordPath).trim();
  ensure(
    migrationEnv.PHONE11_AUTH_BASE_URL === expected.api,
    "Unexpected staging API origin",
  );
  ensure(
    apiEnv.PHONE11_AUTH_BASE_URL === expected.api,
    "Staging API configuration does not match migrator",
  );
  ensure(
    migrationEnv.PHONE11_STAGE_PILOT_EXTENSION === expected.extension,
    "Unexpected pilot extension",
  );
  ensure(
    migrationEnv.PHONE11_STAGE_PILOT_DOMAIN === expected.domain,
    "Unexpected pilot domain",
  );
  ensure(
    apiEnv.SIP_DOMAIN === expected.domain,
    "Unexpected staging SIP domain",
  );
  ensure(
    Number(apiEnv.SIP_PORT) === expected.port &&
      apiEnv.SIP_TRANSPORT === expected.transport,
    "Unexpected staging SIP transport",
  );
  ensure(
    /^android-pilot-7101@stage\.phone11\.ai$/.test(
      migrationEnv.PHONE11_STAGE_PILOT_EMAIL || "",
    ),
    "Unexpected pilot identity",
  );
  ensure(loginPassword.length >= 32, "Pilot login credential is invalid");

  const fixture = validateState(JSON.parse(privateFile(metadataPath)));
  phase = "fixture-ownership";
  const container = JSON.parse(
    docker(["container", "inspect", fixture.container]),
  )[0];
  const network = JSON.parse(
    docker(["network", "inspect", fixture.network]),
  )[0];
  validateRuntime(container, network);
  ensure(
    container.State?.Running && !container.State?.Paused,
    "Owned fixture is not ready",
  );
  ensure(
    !/^PJSIP\/7101-/m.test(
      docker([
        "exec",
        fixture.container,
        "asterisk",
        "-rx",
        "core show channels concise",
      ]),
    ),
    "Extension 7101 has an active call",
  );
  ensure(
    !/^\s*Contact:\s+7101\//m.test(
      docker([
        "exec",
        fixture.container,
        "asterisk",
        "-rx",
        "pjsip show contacts",
      ]),
    ),
    "Extension 7101 is already registered",
  );

  let token = "";
  let sessionRevoked = false;
  let changed = false;
  try {
    phase = "pilot-sign-in";
    const signIn = await nativeFetch(`${expected.api}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Phone11-Client": "native",
      },
      body: JSON.stringify({
        email: migrationEnv.PHONE11_STAGE_PILOT_EMAIL,
        password: loginPassword,
        rememberMe: false,
      }),
    });
    ensure(signIn.status === 200, "Staging pilot sign-in failed");
    token = signIn.headers.get("set-auth-token") || "";
    ensure(token.length >= 32, "Staging pilot session token was not issued");
    await signIn.arrayBuffer();

    const client = createTRPCProxyClient({
      links: [
        httpBatchLink({
          url: `${expected.api}/api/trpc`,
          transformer: superjson,
          headers: { Authorization: `Bearer ${token}` },
          fetch(url, options) {
            return nativeFetch(url, options);
          },
        }),
      ],
    });
    phase = "phone-config";
    const config = await client.phone.getConfig.query();
    ensure(
      config?.configured === true && config.sip,
      "Staging SIP assignment is unavailable",
    );
    ensure(
      config.extension?.number === expected.extension &&
        config.sip.username === expected.extension,
      "Staging SIP assignment identity mismatch",
    );
    ensure(
      config.sip.domain === expected.domain &&
        config.sip.port === expected.port &&
        config.sip.transport === expected.transport,
      "Staging SIP assignment route mismatch",
    );
    ensure(
      /^[A-Za-z0-9_-]{43}$/.test(config.sip.password || ""),
      "Staging SIP credential format is invalid",
    );

    const before = JSON.stringify(fixture);
    const previousConfigs = Object.fromEntries(
      Object.keys(configs(fixture.accounts)).map((name) => [
        name,
        privateFile(path.join(fixture.configDir, name)),
      ]),
    );
    const next = structuredClone(fixture);
    next.accounts[expected.extension].password = config.sip.password;
    const generated = configs(next.accounts);
    changed = before !== JSON.stringify(next);
    try {
      phase = "fixture-reload";
      for (const [name, content] of Object.entries(generated))
        writePrivate(path.join(fixture.configDir, name), content);
      docker(["exec", fixture.container, "asterisk", "-rx", "core reload"]);
      const endpoints = docker([
        "exec",
        fixture.container,
        "asterisk",
        "-rx",
        "pjsip show endpoints",
      ]);
      ensure(
        /Endpoint:\s+7101\/7101/.test(endpoints) &&
          /Endpoint:\s+7102\/7102/.test(endpoints),
        "Fixture endpoints were not restored after reload",
      );
      writePrivate(metadataPath, JSON.stringify(next, null, 2));
    } catch (error) {
      for (const [name, content] of Object.entries(previousConfigs))
        writePrivate(path.join(fixture.configDir, name), content);
      try {
        docker(["exec", fixture.container, "asterisk", "-rx", "core reload"]);
      } catch {}
      throw error;
    }
  } finally {
    if (token) {
      try {
        const signOut = await nativeFetch(`${expected.api}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: "{}",
        });
        sessionRevoked = signOut.status === 200;
        await signOut.arrayBuffer();
      } catch {}
    }
  }
  phase = "session-revocation";
  ensure(sessionRevoked, "Temporary staging session could not be revoked");
  phase = "evidence";
  const evidence = {
    at: new Date().toISOString(),
    status: "PASS",
    changed,
    scope: "Owned synthetic Android fixture only; credential omitted",
    extension: expected.extension,
    domain: expected.domain,
    host: "10.0.2.2",
    port: expected.port,
    transport: expected.transport,
    configurationReloaded: true,
    temporarySessionRevoked: true,
  };
  writePrivate(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch(() => {
  console.error(
    `Staging fixture alignment failed during ${phase}; no credentials or tokens were printed.`,
  );
  process.exitCode = 1;
});
