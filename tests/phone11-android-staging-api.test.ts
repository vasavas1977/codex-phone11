import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  androidStagingApiRouter,
  androidStagingRegisterSchema,
} from "../server/android-staging-api-router";
import {
  createAndroidStagingApiApp,
  readAndroidStagingApiConfig,
} from "../server/android-staging-api";

const commit = "a".repeat(40);
const source: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  K_SERVICE: "phone11-android-staging-api",
  PHONE11_ANDROID_STAGING_API_ENABLED: "1",
  PHONE11_ANDROID_STAGING_API_ENVIRONMENT: "staging",
  PHONE11_ANDROID_STAGING_API_PROJECT: "phone11-stage-20260914",
  PHONE11_ANDROID_STAGING_API_SERVICE: "phone11-android-staging-api",
  PHONE11_ANDROID_STAGING_API_RUNTIME_SERVICE_ACCOUNT:
    "phone11-android-api@phone11-stage-20260914.iam.gserviceaccount.com",
  PHONE11_ANDROID_STAGING_API_PUBLIC_ORIGIN:
    "https://phone11-android-staging-api-413228367517.asia-southeast1.run.app",
  PHONE11_ANDROID_STAGING_PACKAGE: "ai.phone11.mobile.staging",
  PHONE11_ANDROID_FIREBASE_PROJECT_ID: "phone11-stage-20260914",
  PHONE11_ANDROID_FIREBASE_SENDER_ID: "413228367517",
  PHONE11_ANDROID_FIREBASE_APP_ID:
    "1:413228367517:android:f41353883923fc15911e74",
  PHONE11_CLOUDSQL_IAM_DB_AUTH: "1",
  PHONE11_CLOUDSQL_INSTANCE:
    "phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg",
  PG_HOST:
    "/cloudsql/phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg",
  PG_USER: "phone11-android-api@phone11-stage-20260914.iam",
  PG_DATABASE: "phone11_wake_stage",
  PG_SSL: "disable",
  PHONE11_PHONE_SCHEMA_BOOTSTRAP: "0",
  PHONE11_WAKE_ENABLED: "1",
  PHONE11_WAKE_PILOT_SIP_URI: "sip:7101@sip.stage.phone11.test",
  SIP_DOMAIN: "sip.stage.phone11.test",
  PHONE11_AUTH_BASE_URL:
    "https://phone11-android-staging-api-413228367517.asia-southeast1.run.app",
  PHONE11_AUTH_SECRET: "s".repeat(48),
  PHONE11_BUILD_SHA: commit,
};

const tempPaths: string[] = [];
afterEach(() => {
  for (const item of tempPaths.splice(0))
    rmSync(item, { recursive: true, force: true });
});

describe("isolated authenticated Android staging API", () => {
  it("accepts only the exact staging, Cloud SQL IAM, Firebase and runtime identity", () => {
    expect(readAndroidStagingApiConfig(source)).toMatchObject({
      publicOrigin:
        "https://phone11-android-staging-api-413228367517.asia-southeast1.run.app",
      sourceCommit: commit,
    });
    for (const guessedOrigin of [
      "https://phone11-android-staging-api-iwfx6x7hba-as.a.run.app",
      "https://api.stage.phone11.ai",
    ]) {
      expect(() =>
        readAndroidStagingApiConfig({
          ...source,
          PHONE11_ANDROID_STAGING_API_PUBLIC_ORIGIN: guessedOrigin,
          PHONE11_AUTH_BASE_URL: guessedOrigin,
        }),
      ).toThrow("requires its exact HTTPS staging origin");
    }
    const changes: [string, NodeJS.ProcessEnv][] = [
      [
        "production project",
        {
          ...source,
          PHONE11_ANDROID_STAGING_API_PROJECT: "phone11-production",
        },
      ],
      [
        "runtime identity",
        {
          ...source,
          PHONE11_ANDROID_STAGING_API_RUNTIME_SERVICE_ACCOUNT:
            "phone11-fcm-lab@phone11-stage-20260914.iam.gserviceaccount.com",
        },
      ],
      [
        "Cloud SQL socket",
        { ...source, PG_HOST: "/cloudsql/another:region:database" },
      ],
      ["database password", { ...source, PG_PASSWORD: "forbidden" }],
      ["connection URL", { ...source, DATABASE_URL: "postgresql://forbidden" }],
      ["service", { ...source, K_SERVICE: "another-service" }],
      [
        "unrelated browser origin",
        {
          ...source,
          PHONE11_AUTH_TRUSTED_ORIGINS: "https://unrelated.example",
        },
      ],
      ["schema bootstrap", { ...source, PHONE11_PHONE_SCHEMA_BOOTSTRAP: "1" }],
      ["owner fallback", { ...source, OWNER_OPEN_ID: "owner" }],
    ];
    for (const [label, changed] of changes)
      expect(() => readAndroidStagingApiConfig(changed), label).toThrow();
  });

  it("exposes only current-user SIP config and the three Android enrollment procedures", () => {
    const record = androidStagingApiRouter._def.record as any;
    expect(Object.keys(record).sort()).toEqual(["phone", "push"]);
    expect(Object.keys(record.phone)).toEqual(["getConfig"]);
    expect(Object.keys(record.push).sort()).toEqual([
      "enrollWake",
      "register",
      "resolveWakeBinding",
    ]);
    expect(record.phone).not.toHaveProperty("ensurePilotConfig");
    expect(record.push).not.toHaveProperty("triggerCall");
    expect(record.push).not.toHaveProperty("unregister");
  });

  it("accepts only an Android FCM token for the exact commissioned package", () => {
    const valid = {
      token: "provider-token",
      tokenType: "fcm",
      sipUri: "sip:7101@sip.stage.phone11.test",
      deviceId: "device",
      platform: "android",
      bundleId: "ai.phone11.mobile.staging",
    };
    expect(androidStagingRegisterSchema.parse(valid)).toEqual(valid);
    expect(() =>
      androidStagingRegisterSchema.parse({
        ...valid,
        platform: "ios",
        tokenType: "voip",
      }),
    ).toThrow();
    expect(() =>
      androidStagingRegisterSchema.parse({
        ...valid,
        bundleId: "ai.phone11.mobile",
      }),
    ).toThrow();
    expect(
      androidStagingRegisterSchema.parse({ ...valid, sandbox: false }),
    ).toEqual({ ...valid, sandbox: false });
    expect(() =>
      androidStagingRegisterSchema.parse({ ...valid, sandbox: true }),
    ).toThrow();
    expect(() =>
      androidStagingRegisterSchema.parse({ ...valid, extra: true }),
    ).toThrow();
  });

  it("keeps liveness public while unknown and privileged surfaces are absent", async () => {
    const unavailableAuth = {
      getAuth: () => {
        throw new Error("not configured");
      },
      getDatabase: () => {
        throw new Error("not configured");
      },
    } as any;
    const app = createAndroidStagingApiApp({
      source,
      authDependencies: unavailableAuth,
      context: async (opts) => ({ ...opts, user: null }),
    });
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("missing address");
      const origin = `http://127.0.0.1:${address.port}`;
      const health = await fetch(origin + "/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({
        ok: true,
        service: "phone11-android-staging-api",
        environment: "staging",
        projectId: "phone11-stage-20260914",
        build: commit,
      });
      for (const route of [
        "/api/recordings",
        "/api/phone11/lab/wake-evidence",
        "/api/freeswitch",
        "/api/trpc/push.triggerCall",
        "/api/trpc/phone.ensurePilotConfig",
      ]) {
        const response = await fetch(origin + route);
        expect(response.status, route).toBe(404);
      }
      const forbiddenOrigin = await fetch(origin + "/health", {
        headers: { Origin: "https://production.phone11.ai" },
      });
      expect(forbiddenOrigin.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("builds only its dedicated entrypoint and deploys only after explicit execute", () => {
    const root = path.resolve(__dirname, "..");
    const docker = readFileSync(
      path.join(root, "infra/cloud-run/phone11-android-staging-api/Dockerfile"),
      "utf8",
    );
    const deploy = readFileSync(
      path.join(root, "infra/cloud-run/phone11-android-staging-api/deploy.sh"),
      "utf8",
    );
    expect(docker).toContain("server/android-staging-api.ts");
    expect(docker).not.toContain("server/_core/index.ts");
    expect(docker).toContain('CMD ["node","dist/android-staging-api.mjs"]');
    expect(deploy).toContain('EXPECTED_SERVICE="phone11-android-staging-api"');
    expect(deploy).toContain(
      'EXPECTED_ACCOUNT="phone11-android-api@phone11-stage-20260914.iam.gserviceaccount.com"',
    );
    expect(deploy).toContain(
      'EXPECTED_PUBLIC_ORIGIN="https://phone11-android-staging-api-413228367517.asia-southeast1.run.app"',
    );
    expect(deploy).toContain(
      '[ "$PUBLIC_ORIGIN" = "$EXPECTED_PUBLIC_ORIGIN" ]',
    );
    expect(deploy).not.toContain("iwfx6x7hba");
    expect(deploy).not.toContain("api.stage.phone11.ai");
    expect(deploy).toContain('--add-cloudsql-instances="$EXPECTED_INSTANCE"');
    expect(deploy).toContain("--allow-unauthenticated");
    expect(deploy).toContain(
      "PHONE11_AUTH_SECRET=phone11-stage-auth-secret:latest",
    );
    expect(deploy).toContain(
      "runtime identity lacks secret-specific auth access",
    );
    expect(deploy).toContain('x.settings?.tier==="db-f1-micro"');
    expect(deploy).not.toMatch(
      /gcloud projects create|gcloud services enable|gcloud sql instances create|gcloud iam service-accounts create/,
    );
    expect(deploy).not.toContain("DATABASE_URL=");
    expect(deploy.indexOf('if [ "${1:-}" != "--execute" ]')).toBeLessThan(
      deploy.indexOf("gcloud run deploy"),
    );
  });

  it("refuses the wrong project before consulting gcloud", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "phone11-android-api-test-"),
    );
    tempPaths.push(directory);
    const envFile = path.join(directory, "env");
    writeFileSync(envFile, "");
    chmodSync(envFile, 0o600);
    const script = path.resolve(
      __dirname,
      "../infra/cloud-run/phone11-android-staging-api/deploy.sh",
    );
    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PHONE11_ANDROID_API_CLOUDRUN_PROJECT: "phone11-production",
        PHONE11_ANDROID_API_CLOUDRUN_ENV_FILE: envFile,
      },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("exact project is required");
    expect(result.stdout).toBe("");
  });
});
