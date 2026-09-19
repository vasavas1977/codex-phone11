#!/usr/bin/env node
/**
 * Read-only runtime readiness probe for the Phone11 plain-video integration.
 *
 * This probe deliberately does not call Connect11, mint a token, execute a
 * migration, or print configuration values. The production image bundles it
 * as dist/conference-readiness.mjs so it can run inside cp11-backend.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Pool } from "pg";

import {
  connect11PlainVideoTenantConfigEnvironment,
  readServerConnect11PlainVideoTenantConfiguration,
} from "../server/meetings/connect11-plain-video-config";
import { createMeetingsRouter } from "../server/meetings/router";
import {
  inspectPlainVideoAdmissionSchema,
  type PlainVideoAdmissionPreflight,
} from "./phone11-plain-video-admission-preflight";

export type ReadinessDatabaseClient = Parameters<
  typeof inspectPlainVideoAdmissionSchema
>[0];
type RuntimeDatabaseClient = ReadinessDatabaseClient & {
  release?: () => void;
};

export type ConferenceReadinessReport = {
  event: "phone11.conference.readiness";
  readOnly: true;
  pass: boolean;
  providerCalls: 0;
  configuration: {
    variable: typeof connect11PlainVideoTenantConfigEnvironment;
    present: boolean;
    valid: boolean;
    enabled: boolean;
    tenantCount: number;
  };
  capabilityEndpoint: {
    authenticated: boolean;
    defaultOff: boolean;
    tokenMintAttempted: false;
  };
  database: {
    configured: boolean;
    metadataOnly: true;
    readOnlyTransaction: true;
    status: "applied" | "missing" | "partial_or_incompatible" | "unavailable";
    prerequisites: "compatible" | "incompatible" | "unavailable";
  };
};

type ProbeOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  database?: ReadinessDatabaseClient;
};

function hasStrictlyDisabledConfiguration(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const record = value as Record<string, unknown>;
    return (
      record.enabled === false &&
      Object.keys(record).length === 1
    );
  } catch {
    return false;
  }
}

function inspectConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): ConferenceReadinessReport["configuration"] {
  const raw = env[connect11PlainVideoTenantConfigEnvironment];
  const present = typeof raw === "string" && raw.trim() !== "";
  const parsed = readServerConnect11PlainVideoTenantConfiguration(env);
  const valid = present && (parsed.enabled || hasStrictlyDisabledConfiguration(raw));
  return {
    variable: connect11PlainVideoTenantConfigEnvironment,
    present,
    valid,
    enabled: parsed.enabled,
    tenantCount: parsed.enabled ? parsed.tenants.length : 0,
  };
}

async function inspectCapabilityEndpoint(): Promise<
  ConferenceReadinessReport["capabilityEndpoint"]
> {
  const unauthenticated = createMeetingsRouter({}).createCaller({
    user: null,
    req: {},
    res: {},
  } as never);
  let authenticated = false;
  try {
    await unauthenticated.capabilities();
  } catch (error) {
    authenticated =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "UNAUTHORIZED";
  }

  // Exercise the disabled composition with a synthetic authenticated caller.
  // This is an in-process contract check; it cannot reach Connect11.
  const disabled = createMeetingsRouter({
    [connect11PlainVideoTenantConfigEnvironment]: JSON.stringify({ enabled: false }),
  }).createCaller({
    user: { id: 1 },
    req: {},
    res: {},
  } as never);
  const capabilities = await disabled.capabilities();
  const defaultOff =
    capabilities.available === false &&
    capabilities.video === false &&
    capabilities.interpretation === false &&
    capabilities.voiceBot === false &&
    capabilities.recording === false;

  return {
    authenticated,
    defaultOff,
    tokenMintAttempted: false,
  };
}

async function inspectDatabase(
  client: ReadinessDatabaseClient | undefined,
  configured: boolean,
): Promise<ConferenceReadinessReport["database"]> {
  if (!configured || !client) {
    return {
      configured,
      metadataOnly: true,
      readOnlyTransaction: true,
      status: "unavailable",
      prerequisites: "unavailable",
    };
  }

  try {
    const result: PlainVideoAdmissionPreflight =
      await inspectPlainVideoAdmissionSchema(client);
    return {
      configured: true,
      metadataOnly: true,
      readOnlyTransaction: true,
      status:
        result.migration.state === "applied"
          ? "applied"
          : result.migration.state === "partial_or_incompatible"
            ? "partial_or_incompatible"
            : "missing",
      prerequisites: result.prerequisites.status,
    };
  } catch {
    return {
      configured: true,
      metadataOnly: true,
      readOnlyTransaction: true,
      status: "unavailable",
      prerequisites: "unavailable",
    };
  }
}

export async function runConferenceReadinessProbe(
  options: ProbeOptions = {},
): Promise<ConferenceReadinessReport> {
  const env = options.env ?? process.env;
  const configuration = inspectConfiguration(env);
  const capabilityEndpoint = await inspectCapabilityEndpoint();
  const database = await inspectDatabase(
    options.database,
    hasDatabaseConfiguration(env),
  );
  const pass =
    configuration.present &&
    configuration.valid &&
    configuration.enabled &&
    capabilityEndpoint.authenticated &&
    capabilityEndpoint.defaultOff &&
    database.status === "applied" &&
    database.prerequisites === "compatible";

  return {
    event: "phone11.conference.readiness",
    readOnly: true,
    pass,
    providerCalls: 0,
    configuration,
    capabilityEndpoint,
    database,
  };
}

function hasDatabaseConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const hasUrl = Boolean(env.PG_CONNECTION_STRING || env.DATABASE_URL);
  const hasDiscrete = Boolean(
    (env.PG_HOST || env.DB_HOST || env.POSTGRES_HOST) &&
      (env.PG_USER || env.DB_USER || env.POSTGRES_USER) &&
      (env.PG_DATABASE || env.DB_NAME || env.DB_DATABASE || env.POSTGRES_DB) &&
      (env.PG_PASSWORD || env.DB_PASSWORD || env.POSTGRES_PASSWORD),
  );
  return hasUrl || hasDiscrete;
}

function databaseFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Pool {
  const connectionString = env.PG_CONNECTION_STRING || env.DATABASE_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
    });
  }
  return new Pool({
    host: env.PG_HOST || env.DB_HOST || env.POSTGRES_HOST,
    port: Number.parseInt(env.PG_PORT || env.DB_PORT || env.POSTGRES_PORT || "5432", 10),
    user: env.PG_USER || env.DB_USER || env.POSTGRES_USER,
    password: env.PG_PASSWORD || env.DB_PASSWORD || env.POSTGRES_PASSWORD,
    database: env.PG_DATABASE || env.DB_NAME || env.DB_DATABASE || env.POSTGRES_DB,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
}

export function formatConferenceReadinessReport(
  result: ConferenceReadinessReport,
): string {
  const lines = [
    `${result.pass ? "PASS" : "FAIL"}: Phone11 conference runtime readiness`,
    `Configuration: ${result.configuration.present ? "present" : "missing"}/${result.configuration.valid ? "valid" : "invalid"}/${result.configuration.enabled ? "enabled" : "disabled"}`,
    `Capability endpoint: ${result.capabilityEndpoint.authenticated ? "authenticated" : "unauthenticated"}/${result.capabilityEndpoint.defaultOff ? "default-off" : "unexpected"}`,
    `Database metadata: ${result.database.status}/${result.database.prerequisites}`,
    "Provider calls: 0; token mint: not attempted; migration: not executed.",
  ];
  return lines.join("\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";

async function runFromCommandLine(): Promise<void> {
  const env = process.env;
  const configuration = inspectConfiguration(env);
  const database = hasDatabaseConfiguration(env)
    ? databaseFromEnvironment(env)
    : undefined;
  let client: RuntimeDatabaseClient | undefined;
  try {
    if (database) client = await database.connect();
    const result = await runConferenceReadinessProbe({ env, database: client });
    console.info(formatConferenceReadinessReport(result));
    if (!result.pass) process.exitCode = 2;
  } catch {
    // Keep command-line output free of connection strings and provider errors.
    const result = await runConferenceReadinessProbe({ env, database: undefined });
    console.info(formatConferenceReadinessReport({
      ...result,
      configuration,
      database: {
        configured: hasDatabaseConfiguration(env),
        metadataOnly: true,
        readOnlyTransaction: true,
        status: "unavailable",
        prerequisites: "unavailable",
      },
      pass: false,
    }));
    process.exitCode = 1;
  } finally {
    client?.release?.();
    await database?.end();
  }
}

if (invokedPath === fileURLToPath(import.meta.url))
  void runFromCommandLine();
