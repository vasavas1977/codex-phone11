import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import {
  createExpressMiddleware,
  type CreateExpressContextOptions,
} from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./_core/auth-routes";
import { readAuthConfig, type Phone11Auth } from "./_core/phone11-auth";
import { createContext, type TrpcContext } from "./_core/context";
import {
  androidStagingApiRouter,
  ANDROID_STAGING_PACKAGE,
} from "./android-staging-api-router";
import type { Pool } from "pg";

const EXPECTED = {
  project: "phone11-stage-20260914",
  service: "phone11-android-staging-api",
  runtimeServiceAccount:
    "phone11-android-api@phone11-stage-20260914.iam.gserviceaccount.com",
  cloudSqlInstance:
    "phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg",
  databaseUser: "phone11-android-api@phone11-stage-20260914.iam",
  database: "phone11_wake_stage",
  firebaseSenderId: "413228367517",
  firebaseAppId: "1:413228367517:android:f41353883923fc15911e74",
  sipUri: "sip:7101@sip.stage.phone11.test",
} as const;

export type AndroidStagingApiConfig = {
  publicOrigin: string;
  sourceCommit: string;
  trustedOrigins: string[];
};

const forbiddenDatabaseKeys = [
  "DATABASE_URL",
  "PG_CONNECTION_STRING",
  "PG_PASSWORD",
  "DB_PASSWORD",
  "POSTGRES_PASSWORD",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OWNER_OPEN_ID",
] as const;

export function readAndroidStagingApiConfig(
  source: NodeJS.ProcessEnv = process.env,
): AndroidStagingApiConfig {
  const exact = (key: string, value: string) => {
    if (source[key] !== value)
      throw new Error(`Android staging API ${key} mismatch`);
  };
  exact("NODE_ENV", "production");
  exact("PHONE11_ANDROID_STAGING_API_ENABLED", "1");
  exact("PHONE11_ANDROID_STAGING_API_ENVIRONMENT", "staging");
  exact("PHONE11_ANDROID_STAGING_API_PROJECT", EXPECTED.project);
  exact("PHONE11_ANDROID_STAGING_API_SERVICE", EXPECTED.service);
  exact(
    "PHONE11_ANDROID_STAGING_API_RUNTIME_SERVICE_ACCOUNT",
    EXPECTED.runtimeServiceAccount,
  );
  exact("PHONE11_ANDROID_STAGING_PACKAGE", ANDROID_STAGING_PACKAGE);
  exact("PHONE11_ANDROID_FIREBASE_PROJECT_ID", EXPECTED.project);
  exact("PHONE11_ANDROID_FIREBASE_SENDER_ID", EXPECTED.firebaseSenderId);
  exact("PHONE11_ANDROID_FIREBASE_APP_ID", EXPECTED.firebaseAppId);
  exact("PHONE11_CLOUDSQL_IAM_DB_AUTH", "1");
  exact("PHONE11_CLOUDSQL_INSTANCE", EXPECTED.cloudSqlInstance);
  exact("PG_HOST", `/cloudsql/${EXPECTED.cloudSqlInstance}`);
  exact("PG_USER", EXPECTED.databaseUser);
  exact("PG_DATABASE", EXPECTED.database);
  exact("PG_SSL", "disable");
  exact("PHONE11_PHONE_SCHEMA_BOOTSTRAP", "0");
  exact("PHONE11_WAKE_ENABLED", "1");
  exact("PHONE11_WAKE_PILOT_SIP_URI", EXPECTED.sipUri);
  exact("SIP_DOMAIN", "sip.stage.phone11.test");
  if (source.K_SERVICE !== EXPECTED.service)
    throw new Error("Android staging API Cloud Run service mismatch");
  if (forbiddenDatabaseKeys.some((key) => source[key]))
    throw new Error(
      "Android staging API forbids database credentials and fallback identity",
    );
  if (!/^[a-f0-9]{40}$/.test(source.PHONE11_BUILD_SHA || ""))
    throw new Error("Android staging API requires an exact source commit");

  const origin = new URL(
    source.PHONE11_ANDROID_STAGING_API_PUBLIC_ORIGIN || "",
  );
  const validHostname =
    origin.hostname === "api.stage.phone11.ai" ||
    /^phone11-android-staging-api-[a-z0-9]+-as\.a\.run\.app$/.test(
      origin.hostname,
    );
  if (
    origin.protocol !== "https:" ||
    origin.origin !== origin.href.replace(/\/$/, "") ||
    !validHostname ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error(
      "Android staging API requires its exact HTTPS staging origin",
    );
  }
  exact("PHONE11_AUTH_BASE_URL", origin.origin);
  const auth = readAuthConfig(source);
  if (auth.trustedOrigins.some((value) => value !== origin.origin)) {
    throw new Error(
      "Android staging API does not trust unrelated browser origins",
    );
  }
  return {
    publicOrigin: origin.origin,
    sourceCommit: source.PHONE11_BUILD_SHA!,
    trustedOrigins: auth.trustedOrigins,
  };
}

type Options = {
  source?: NodeJS.ProcessEnv;
  authDependencies?: { getAuth?: () => Phone11Auth; getDatabase?: () => Pool };
  context?: (opts: CreateExpressContextOptions) => Promise<TrpcContext>;
};

function exactCors(origins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    res.vary("Origin");
    if (origin && !origins.includes(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Phone11-Client",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

/** Construct only the public mobile auth and owned Android enrollment surface. */
export function createAndroidStagingApiApp(options: Options = {}): Express {
  const source = options.source ?? process.env;
  const config = readAndroidStagingApiConfig(source);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(exactCors(config.trustedOrigins));
  registerAuthRoutes(app, options.authDependencies);
  app.use(express.json({ limit: "64kb" }));
  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      service: EXPECTED.service,
      environment: "staging",
      projectId: EXPECTED.project,
      build: config.sourceCommit,
    });
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: androidStagingApiRouter,
      createContext: options.context ?? createContext,
    }),
  );
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

export function startAndroidStagingApi(
  source: NodeJS.ProcessEnv = process.env,
): Server {
  const port = Number(source.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid Cloud Run port");
  const server = createServer(createAndroidStagingApiApp({ source }));
  server.listen(port, "0.0.0.0", () =>
    console.log(
      `[phone11-android-staging-api] listening port=${port} build=${source.PHONE11_BUILD_SHA}`,
    ),
  );
  process.once("SIGTERM", () => server.close());
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    startAndroidStagingApi();
  } catch {
    console.error(
      "Phone11 Android staging API refused to start: commissioning is unavailable",
    );
    process.exitCode = 1;
  }
}
