#!/usr/bin/env node
// Operator-only fixture utility. This is intentionally not imported by the
// server, does not invoke migration SQL, and never sends a provider request.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

export const DATABASE_URL_ENV = "PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL";

type FixtureClient = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  release(): void;
};

type FixturePool = {
  connect(): Promise<FixtureClient>;
};

type AuthorizedUserRow = { user_id: number | string };

export type PlainVideoFixtureRequest = {
  tenantId: number;
  userIds: readonly [number, number];
  apply: boolean;
};

export type PlainVideoFixtureResult = {
  mode: "dry_run" | "applied";
  admittedParticipants: 2;
};

type FixtureReferences = {
  meetingId: string;
  roomRevision: string;
  members: readonly [
    { participantId: string; revision: string },
    { participantId: string; revision: string },
  ];
};

export class PlainVideoFixtureInputError extends Error {
  constructor() {
    super("Expected one --tenant-id and exactly two distinct --user-id values");
  }
}

export class PlainVideoFixtureUnavailableError extends Error {
  constructor() {
    super("Plain-video fixture provisioning is unavailable");
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Parses only operator IDs. Room and participant references are never accepted from a caller. */
export function parseFixtureArguments(
  argv: readonly string[],
): PlainVideoFixtureRequest {
  let tenantId: number | null = null;
  const userIds: number[] = [];
  let apply = false;
  let dryRunRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (apply) throw new PlainVideoFixtureInputError();
      apply = true;
      continue;
    }
    if (argument === "--dry-run") {
      if (dryRunRequested) throw new PlainVideoFixtureInputError();
      dryRunRequested = true;
      continue;
    }
    if (argument !== "--tenant-id" && argument !== "--user-id")
      throw new PlainVideoFixtureInputError();

    const value = parsePositiveInteger(argv[index + 1]);
    if (value === null) throw new PlainVideoFixtureInputError();
    index += 1;
    if (argument === "--tenant-id") {
      if (tenantId !== null) throw new PlainVideoFixtureInputError();
      tenantId = value;
    } else {
      userIds.push(value);
    }
  }

  if (tenantId === null || userIds.length !== 2 || userIds[0] === userIds[1])
    throw new PlainVideoFixtureInputError();
  if (apply && dryRunRequested) throw new PlainVideoFixtureInputError();
  return { tenantId, userIds: [userIds[0], userIds[1]], apply };
}

function participantIdFrom(uuid: string): string {
  return `phone11_fixture_${uuid.replaceAll("-", "")}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isOpaqueParticipantId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,96}$/.test(value);
}

/** Generates all durable references locally; none are caller-selected or logged. */
export function deriveFixtureReferences(
  nextUuid: () => string = randomUUID,
): FixtureReferences {
  const meetingId = nextUuid();
  const roomRevision = nextUuid();
  const firstRevision = nextUuid();
  const secondRevision = nextUuid();
  const firstParticipantUuid = nextUuid();
  const secondParticipantUuid = nextUuid();
  const firstParticipantId = participantIdFrom(firstParticipantUuid);
  const secondParticipantId = participantIdFrom(secondParticipantUuid);

  if (
    ![
      meetingId,
      roomRevision,
      firstRevision,
      secondRevision,
      firstParticipantUuid,
      secondParticipantUuid,
    ].every(isUuid) ||
    ![firstParticipantId, secondParticipantId].every(isOpaqueParticipantId) ||
    firstParticipantId === secondParticipantId
  )
    throw new PlainVideoFixtureUnavailableError();

  return {
    meetingId,
    roomRevision,
    members: [
      { participantId: firstParticipantId, revision: firstRevision },
      { participantId: secondParticipantId, revision: secondRevision },
    ],
  };
}

function containsExactlyRequestedUsers(
  rows: readonly AuthorizedUserRow[],
  request: PlainVideoFixtureRequest,
): boolean {
  if (rows.length !== 2) return false;
  const actual = rows.map((row) => {
    if (typeof row.user_id === "number") return row.user_id;
    return /^[1-9][0-9]*$/.test(row.user_id) ? Number(row.user_id) : Number.NaN;
  });
  if (!actual.every((id) => Number.isSafeInteger(id) && id > 0)) return false;
  return (
    new Set(actual).size === 2 &&
    actual.every((id) => request.userIds.includes(id))
  );
}

function isTrustedRequest(request: PlainVideoFixtureRequest): boolean {
  return (
    Number.isSafeInteger(request.tenantId) &&
    request.tenantId > 0 &&
    Array.isArray(request.userIds) &&
    request.userIds.length === 2 &&
    request.userIds.every((id) => Number.isSafeInteger(id) && id > 0) &&
    request.userIds[0] !== request.userIds[1] &&
    typeof request.apply === "boolean"
  );
}

function authorizedUsersQuery(lockRows: boolean): string {
  return `SELECT u.id AS user_id
            FROM tenants t
            JOIN users u ON u.id = ANY($2::integer[])
            JOIN tenant_memberships tm
              ON tm.tenant_id = t.id AND tm.user_id = u.id AND tm.status = 'active'
            JOIN phone11_auth_identity ai
              ON ai.legacy_user_id = u.id AND ai.disabled_at IS NULL
           WHERE t.id = $1 AND t.status = 'active'
           ORDER BY u.id${lockRows ? " FOR UPDATE OF t, u, tm, ai" : ""}`;
}

const insertRoomQuery = `INSERT INTO phone11_plain_video_admission_rooms
  (id, tenant_id, state, revision)
  VALUES ($1, $2, 'open', $3)`;

const insertMembersQuery = `INSERT INTO phone11_plain_video_admission_members
  (meeting_id, tenant_id, user_id, participant_id, grant_profile, lobby_state, revision)
  VALUES
    ($1, $2, $3, $4, 'interactive', 'admitted', $5),
    ($1, $2, $6, $7, 'interactive', 'admitted', $8)`;

/**
 * Validates both participants in one tenant-scoped transaction. The default
 * read-only path proves eligibility without creating any room or member rows.
 */
export async function provisionPlainVideoFixture(
  pool: FixturePool,
  request: PlainVideoFixtureRequest,
  nextUuid: () => string = randomUUID,
): Promise<PlainVideoFixtureResult> {
  if (!isTrustedRequest(request)) throw new PlainVideoFixtureUnavailableError();
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query(request.apply ? "BEGIN" : "BEGIN READ ONLY");
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '3s'");

    const authorized = await client.query<AuthorizedUserRow>(
      authorizedUsersQuery(request.apply),
      [request.tenantId, request.userIds],
    );
    if (!containsExactlyRequestedUsers(authorized.rows, request))
      throw new PlainVideoFixtureUnavailableError();

    const references = deriveFixtureReferences(nextUuid);
    if (request.apply) {
      await client.query(insertRoomQuery, [
        references.meetingId,
        request.tenantId,
        references.roomRevision,
      ]);
      await client.query(insertMembersQuery, [
        references.meetingId,
        request.tenantId,
        request.userIds[0],
        references.members[0].participantId,
        references.members[0].revision,
        request.userIds[1],
        references.members[1].participantId,
        references.members[1].revision,
      ]);
    }

    await client.query("COMMIT");
    return {
      mode: request.apply ? "applied" : "dry_run",
      admittedParticipants: 2,
    };
  } catch (error) {
    if (transactionStarted)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function formatResult(result: PlainVideoFixtureResult): string {
  if (result.mode === "dry_run")
    return "Plain-video fixture dry run passed: two eligible participants; no records were created.";
  return "Plain-video fixture provisioned: one room with two admitted participants.";
}

async function main(): Promise<void> {
  const request = parseFixtureArguments(process.argv.slice(2));
  const connectionString = process.env[DATABASE_URL_ENV];
  if (!connectionString) throw new PlainVideoFixtureUnavailableError();
  const pool = new Pool({ connectionString });
  try {
    console.info(formatResult(await provisionPlainVideoFixture(pool, request)));
  } finally {
    await pool.end();
  }
}

const isDirectExecution =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  void main().catch(() => {
    // Do not expose database errors, credentials, tokens, provider room names,
    // or provider identities through this operator utility.
    console.error(
      "Plain-video fixture provisioning failed without creating a result.",
    );
    process.exitCode = 1;
  });
}
