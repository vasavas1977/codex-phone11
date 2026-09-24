/**
 * Phone Provisioning Module
 *
 * Handles SIP auto-provisioning for users after login.
 * Connects directly to the PostgreSQL database (same as Kamailio).
 *
 * Flow:
 * 1. User logs in -> app calls phone.getConfig
 * 2. Server looks up user's assigned extension
 * 3. If no extension assigned, pilot provisioning can create one
 * 4. Returns SIP credentials to the app
 */

import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./pbx/db";
import { computeHA1, computeHA1B, createSipCredentials, decryptSecret, regenerateSipCredentials } from "./pbx/sip-secrets";

export interface PhoneConfig {
  configured: boolean;
  tenantId?: number;
  extension?: {
    /** Selected tenant-owned extension ID, bound to the same SIP row below. */
    id?: number;
    number: string;
    displayName: string;
    callerIdName?: string;
    callerIdNumber?: string;
  };
  sip?: {
    username: string;
    password: string;
    domain: string;
    port: number;
    transport: "UDP" | "TCP" | "TLS";
    proxy?: string;
    srtp: boolean;
    stun?: string;
  };
  organization?: {
    id: number;
    name: string;
    plan: string;
  };
  dids?: Array<{
    number: string;
    description: string;
  }>;
}

const DEFAULT_SIP_DOMAIN = process.env.SIP_DOMAIN || "sip.phone11.ai";
const DEFAULT_SIP_TRANSPORT: "UDP" | "TCP" | "TLS" = "TLS";
const DEFAULT_SIP_STUN = process.env.SIP_STUN_SERVER || "stun.l.google.com:19302";

let schemaReady: Promise<void> | null = null;

function normalizeSipTransport(value?: string | null): "UDP" | "TCP" | "TLS" {
  const normalized = value?.toUpperCase();
  if (normalized === "UDP" || normalized === "TCP" || normalized === "TLS") {
    return normalized;
  }
  return DEFAULT_SIP_TRANSPORT;
}

function getSipPort(transport: "UDP" | "TCP" | "TLS"): number {
  const explicit = Number.parseInt(process.env.SIP_PORT || "", 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return transport === "TLS" ? 5061 : 5060;
}

function toBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== "string") return null;
  if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return Buffer.from(value, "base64");
}

function getSipPassword(row: any): string | null {
  const username = row.account_sip_username || row.sip_username || row.extension_number;
  const domain = row.account_sip_domain || row.sip_domain || DEFAULT_SIP_DOMAIN;
  const password = row.subscriber_password;
  if (!username || !domain || typeof password !== "string" || !password) return null;
  if (row.account_id !== null && row.account_id !== undefined &&
      ((row.sip_username || row.extension_number) !== username ||
       (row.sip_domain || DEFAULT_SIP_DOMAIN) !== domain)) return null;

  const ha1 = computeHA1(username, domain, password);
  const ha1b = computeHA1B(username, domain, domain, password);
  if (!ha1 || !ha1b || row.subscriber_ha1 !== ha1 || row.subscriber_ha1b !== ha1b) return null;
  if (row.account_id !== null && row.account_id !== undefined) {
    if (row.account_ha1 !== ha1 || row.account_ha1b !== ha1b) return null;
    const hasSecret = row.secret_ciphertext != null || row.secret_iv != null || row.secret_tag != null;
    if (hasSecret) {
      const ciphertext = toBuffer(row.secret_ciphertext);
      const iv = toBuffer(row.secret_iv);
      const tag = toBuffer(row.secret_tag);
      if (!ciphertext || !iv || !tag) return null;
      try {
        if (decryptSecret(ciphertext, iv, tag) !== password) return null;
      } catch {
        return null;
      }
    }
  } else if (row.sip_password !== password) {
    // A legacy extension has no account digest, so its own stored secret must
    // prove ownership of the global Kamailio subscriber row.
    return null;
  }
  return password;
}

function buildConfig(ext: any, password: string, dids: Array<{ number: string; description: string }> = []): PhoneConfig {
  const transport = normalizeSipTransport(ext.transport_preference || ext.transport);
  const sipDomain = ext.account_sip_domain || ext.sip_domain || DEFAULT_SIP_DOMAIN;
  const sipUsername = ext.account_sip_username || ext.sip_username || ext.extension_number;

  return {
    configured: true,
    tenantId: Number.isSafeInteger(ext.tenant_id) && ext.tenant_id > 0 ? ext.tenant_id : undefined,
    extension: {
      id: Number.isSafeInteger(ext.id) && ext.id > 0 ? ext.id : undefined,
      number: ext.extension_number,
      displayName: ext.display_name || `Extension ${ext.extension_number}`,
      callerIdName: ext.caller_id_name,
      callerIdNumber: ext.caller_id_number,
    },
    sip: {
      username: sipUsername,
      password,
      domain: sipDomain,
      port: getSipPort(transport),
      transport,
      srtp: true,
      stun: DEFAULT_SIP_STUN,
    },
    organization: {
      id: ext.org_id || ext.tenant_id || 1,
      name: ext.org_name || ext.tenant_name || "Phone11",
      plan: ext.org_plan || ext.tenant_plan || "business",
    },
    dids,
  };
}

async function applyPhoneProvisioningSchema(db: ReturnType<typeof getPool>) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS subscriber (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) NOT NULL DEFAULT '',
      domain VARCHAR(64) NOT NULL DEFAULT '',
      password VARCHAR(128) NOT NULL DEFAULT '',
      ha1 VARCHAR(128) NOT NULL DEFAULT '',
      ha1b VARCHAR(128) NOT NULL DEFAULT '',
      email_address VARCHAR(128) NOT NULL DEFAULT '',
      rpid VARCHAR(128) DEFAULT NULL,
      UNIQUE (username, domain)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL DEFAULT 'Phone11',
      plan VARCHAR(64) NOT NULL DEFAULT 'business',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL DEFAULT 'Phone11',
      plan VARCHAR(64) NOT NULL DEFAULT 'business',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    INSERT INTO organizations (id, name, plan)
    VALUES (1, 'Phone11', 'business')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO tenants (id, name, plan, status)
    VALUES (1, 'Phone11', 'business', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extensions (
      id SERIAL PRIMARY KEY,
      org_id INTEGER DEFAULT 1,
      tenant_id INTEGER DEFAULT 1,
      user_id INTEGER,
      extension_number VARCHAR(32) NOT NULL,
      display_name VARCHAR(128),
      type VARCHAR(32) NOT NULL DEFAULT 'user',
      sip_username VARCHAR(64),
      sip_domain VARCHAR(128),
      sip_password VARCHAR(128),
      caller_id_name VARCHAR(128),
      caller_id_number VARCHAR(64),
      transport VARCHAR(16) NOT NULL DEFAULT 'TLS',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      voicemail_enabled BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const extensionColumns = [
    "ADD COLUMN IF NOT EXISTS org_id INTEGER DEFAULT 1",
    "ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1",
    "ADD COLUMN IF NOT EXISTS user_id INTEGER",
    "ADD COLUMN IF NOT EXISTS display_name VARCHAR(128)",
    "ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'user'",
    "ADD COLUMN IF NOT EXISTS sip_username VARCHAR(64)",
    "ADD COLUMN IF NOT EXISTS sip_domain VARCHAR(128)",
    "ADD COLUMN IF NOT EXISTS sip_password VARCHAR(128)",
    "ADD COLUMN IF NOT EXISTS caller_id_name VARCHAR(128)",
    "ADD COLUMN IF NOT EXISTS caller_id_number VARCHAR(64)",
    "ADD COLUMN IF NOT EXISTS transport VARCHAR(16) NOT NULL DEFAULT 'TLS'",
    "ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'",
    "ADD COLUMN IF NOT EXISTS voicemail_enabled BOOLEAN NOT NULL DEFAULT false",
    "ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
    "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
  ];

  for (const column of extensionColumns) {
    await db.query(`ALTER TABLE extensions ${column}`);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_extensions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      extension_id INTEGER NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, extension_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sip_accounts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER DEFAULT 1,
      org_id INTEGER DEFAULT 1,
      extension_id INTEGER REFERENCES extensions(id) ON DELETE CASCADE,
      user_id INTEGER,
      sip_username VARCHAR(64) NOT NULL,
      sip_domain VARCHAR(128) NOT NULL DEFAULT '${DEFAULT_SIP_DOMAIN}',
      ha1 VARCHAR(128),
      ha1b VARCHAR(128),
      secret_ciphertext BYTEA,
      secret_iv BYTEA,
      secret_tag BYTEA,
      dek_id VARCHAR(64),
      transport_preference VARCHAR(16) NOT NULL DEFAULT 'TLS',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      last_registered_at TIMESTAMPTZ,
      last_registered_contact TEXT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const sipAccountColumns = [
    "ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1",
    "ADD COLUMN IF NOT EXISTS org_id INTEGER DEFAULT 1",
    "ADD COLUMN IF NOT EXISTS extension_id INTEGER",
    "ADD COLUMN IF NOT EXISTS user_id INTEGER",
    "ADD COLUMN IF NOT EXISTS sip_username VARCHAR(64)",
    `ADD COLUMN IF NOT EXISTS sip_domain VARCHAR(128) DEFAULT '${DEFAULT_SIP_DOMAIN}'`,
    "ADD COLUMN IF NOT EXISTS ha1 VARCHAR(128)",
    "ADD COLUMN IF NOT EXISTS ha1b VARCHAR(128)",
    "ADD COLUMN IF NOT EXISTS secret_ciphertext BYTEA",
    "ADD COLUMN IF NOT EXISTS secret_iv BYTEA",
    "ADD COLUMN IF NOT EXISTS secret_tag BYTEA",
    "ADD COLUMN IF NOT EXISTS dek_id VARCHAR(64)",
    "ADD COLUMN IF NOT EXISTS transport_preference VARCHAR(16) NOT NULL DEFAULT 'TLS'",
    "ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'",
    "ADD COLUMN IF NOT EXISTS last_registered_at TIMESTAMPTZ",
    "ADD COLUMN IF NOT EXISTS last_registered_contact TEXT",
    "ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
    "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
  ];

  for (const column of sipAccountColumns) {
    await db.query(`ALTER TABLE sip_accounts ${column}`);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS did_numbers (
      id SERIAL PRIMARY KEY,
      org_id INTEGER DEFAULT 1,
      tenant_id INTEGER DEFAULT 1,
      number VARCHAR(64) NOT NULL,
      description TEXT,
      destination_type VARCHAR(32) NOT NULL DEFAULT 'extension',
      destination_value VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const didColumns = [
    "ADD COLUMN IF NOT EXISTS org_id INTEGER DEFAULT 1",
    "ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1",
    "ADD COLUMN IF NOT EXISTS description TEXT",
    "ADD COLUMN IF NOT EXISTS destination_type VARCHAR(32) NOT NULL DEFAULT 'extension'",
    "ADD COLUMN IF NOT EXISTS destination_value VARCHAR(64)",
    "ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'",
    "ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
    "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
  ];

  for (const column of didColumns) {
    await db.query(`ALTER TABLE did_numbers ${column}`);
  }
}

async function ensurePhoneProvisioningSchema(db: ReturnType<typeof getPool>) {
  if (!schemaReady) {
    schemaReady = applyPhoneProvisioningSchema(db).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function getNextPilotExtensionNumber(db: ReturnType<typeof getPool>): Promise<string> {
  const seed = Number.parseInt(process.env.PILOT_EXTENSION_START || "1020", 10);
  const result = await db.query(`
    SELECT MAX(extension_number::integer) AS max_extension
    FROM extensions
    WHERE extension_number ~ '^[0-9]+$'
      AND deleted_at IS NULL
  `);
  const currentMax = Number.parseInt(result.rows[0]?.max_extension || "", 10);
  return String(Math.max(Number.isFinite(currentMax) ? currentMax + 1 : seed, seed));
}

/**
 * Get phone configuration for a logged-in user.
 */
export async function getPhoneConfig(userId: number, openId: string): Promise<PhoneConfig> {
  const db = getPool();

  try {
    await ensurePhoneProvisioningSchema(db);

    const assignedResult = await db.query(`
      SELECT e.*, ue.is_primary, o.name as org_name, o.plan as org_plan,
             t.name as tenant_name, t.plan as tenant_plan,
             sa.id as account_id, sa.sip_username as account_sip_username,
             sa.sip_domain as account_sip_domain, sa.ha1 as account_ha1,
             sa.ha1b as account_ha1b, sa.secret_ciphertext, sa.secret_iv,
             sa.secret_tag, sa.transport_preference,
             sub.password as subscriber_password, sub.ha1 as subscriber_ha1,
             sub.ha1b as subscriber_ha1b
      FROM extensions e
      LEFT JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = $1
      JOIN tenant_memberships tm ON tm.user_id = $1 AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
      JOIN tenants active_tenant ON active_tenant.id = e.tenant_id AND active_tenant.status = 'active'
      LEFT JOIN organizations o ON COALESCE(e.org_id, 1) = o.id
      LEFT JOIN tenants t ON COALESCE(e.tenant_id, e.org_id, 1) = t.id
      LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
      LEFT JOIN subscriber sub ON sub.username = COALESCE(sa.sip_username, e.sip_username, e.extension_number)
        AND sub.domain = COALESCE(sa.sip_domain, e.sip_domain, $2)
      WHERE e.type = 'user'
        AND (
          -- A live SIP account has two current owner records. A stale
          -- user_extensions row must never disclose the account password.
          (sa.id IS NOT NULL AND e.user_id = $1 AND sa.user_id = $1 AND ue.user_id = $1)
          OR (sa.id IS NULL AND e.user_id = $1 AND ue.user_id = $1)
          OR (sa.id IS NULL AND e.user_id IS NULL AND ue.user_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM user_extensions other_ue
                WHERE other_ue.extension_id = e.id AND other_ue.user_id <> $1
              ))
        )
        AND COALESCE(e.status, 'active') = 'active'
        AND e.deleted_at IS NULL
        -- A legacy extension without a sip_accounts row may use its existing
        -- credential fields. Once an account exists, only its live state can
        -- provision credentials; suspended/deleted accounts fail closed.
        AND (sa.id IS NULL OR (sa.status = 'active' AND sa.deleted_at IS NULL))
        AND NOT EXISTS (
          SELECT 1 FROM extensions other_e
          WHERE other_e.id <> e.id AND other_e.deleted_at IS NULL
            AND COALESCE(NULLIF(other_e.sip_username, ''), other_e.extension_number) =
              COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
            AND COALESCE(NULLIF(other_e.sip_domain, ''), $2) =
              COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $2)
        )
        AND NOT EXISTS (
          SELECT 1 FROM sip_accounts other_sa
          WHERE other_sa.id IS DISTINCT FROM sa.id
            AND other_sa.status = 'active' AND other_sa.deleted_at IS NULL
            AND other_sa.sip_username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
            AND other_sa.sip_domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $2)
        )
        AND NOT EXISTS (
          SELECT 1 FROM sip_accounts second_sa
          WHERE second_sa.extension_id = e.id AND second_sa.tenant_id = e.tenant_id
            AND second_sa.id IS DISTINCT FROM sa.id
            AND second_sa.status = 'active' AND second_sa.deleted_at IS NULL
        )
        AND (SELECT COUNT(*) FROM subscriber matching_sub
          WHERE matching_sub.username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
            AND matching_sub.domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $2)) = 1
      ORDER BY ue.is_primary DESC NULLS LAST, e.id ASC
      LIMIT 1
    `, [userId, DEFAULT_SIP_DOMAIN]);

    if (assignedResult.rows.length > 0) {
      const ext = assignedResult.rows[0];
      const password = getSipPassword(ext);
      if (!password) return { configured: false };
      const didsResult = await db.query(`
        SELECT number, description FROM did_numbers
        WHERE tenant_id = $1
          AND destination_type = 'extension'
          AND destination_value = $2
          AND COALESCE(status, 'active') = 'active'
      `, [ext.tenant_id, ext.extension_number]);

      return buildConfig(
        ext,
        password,
        didsResult.rows.map((d: any) => ({
          number: d.number,
          description: d.description || "",
        })),
      );
    }

    return { configured: false };
  } catch (error) {
    console.error("[PhoneProvisioning] getPhoneConfig error:", error);
    throw error;
  }
}

/**
 * Change a tenant-owned extension's SIP authentication in the same transaction
 * as its assignee. A previous assignee has already received the old password,
 * so changing database ownership alone does not revoke calling access.
 * Existing registrar contacts and established dialogs require a separate
 * operator-verified invalidation; this only changes future authentication.
 */
export async function rotateExtensionSipAuth(
  client: PoolClient,
  extensionId: number,
  tenantId: number,
): Promise<void> {
  const state = await lockExtensionSipAuth(client, extensionId, tenantId);
  const creds = regenerateSipCredentials(state.username, state.domain, state.domain);
  if (state.accountId !== null) {
    const updated = await client.query(
      `UPDATE sip_accounts SET ha1 = $1, ha1b = $2, secret_ciphertext = $3,
              secret_iv = $4, secret_tag = $5, dek_id = $6, updated_at = NOW()
        WHERE id = $7 AND extension_id = $8 AND tenant_id = $9
          AND status = 'active' AND deleted_at IS NULL RETURNING id`,
      [creds.ha1, creds.ha1b, creds.secretCiphertext, creds.secretIv,
        creds.secretTag, creds.dekId, state.accountId, extensionId, tenantId],
    );
    if (updated.rows.length !== 1) throw new Error("SIP account changed before reassignment.");
    await client.query(
      `UPDATE extensions SET sip_password = '' WHERE id = $1 AND tenant_id = $2`,
      [extensionId, tenantId],
    );
  } else {
    // Preserve provisioning for an old extension with no sip_accounts row.
    await client.query(
      `UPDATE extensions SET sip_password = $1 WHERE id = $2 AND tenant_id = $3`,
      [creds.plaintextPassword, extensionId, tenantId],
    );
  }
  if (state.subscriberPresent) {
    const updated = await client.query(
      `UPDATE subscriber SET password = $3, ha1 = $4, ha1b = $5
        WHERE username = $1 AND domain = $2 AND ha1 = $6 AND ha1b = $7
        RETURNING username`,
      [state.username, state.domain, creds.plaintextPassword, creds.ha1,
        creds.ha1b, state.ha1, state.ha1b],
    );
    if (updated.rows.length !== 1) throw new Error("SIP subscriber changed before reassignment.");
  } else {
    const inserted = await client.query(
      `INSERT INTO subscriber (username, domain, password, ha1, ha1b)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username, domain) DO NOTHING RETURNING username`,
      [state.username, state.domain, creds.plaintextPassword, creds.ha1, creds.ha1b],
    );
    if (inserted.rows.length !== 1) throw new Error("SIP subscriber changed before reassignment.");
  }
}

/** Remove only an auth row proven to belong to the locked extension/account. */
export async function revokeExtensionSipAuth(
  client: PoolClient,
  extensionId: number,
  tenantId: number,
): Promise<void> {
  const state = await lockExtensionSipAuth(client, extensionId, tenantId, true);
  if (!state.subscriberPresent) return;
  const deleted = await client.query(
    `DELETE FROM subscriber WHERE username = $1 AND domain = $2
       AND ha1 = $3 AND ha1b = $4 RETURNING username`,
    [state.username, state.domain, state.ha1, state.ha1b],
  );
  if (deleted.rows.length !== 1) throw new Error("SIP subscriber changed before deletion.");
}

/** A suspended extension comes back only with a new credential, never its old password. */
export async function reactivateExtensionSipAuth(
  client: PoolClient,
  extensionId: number,
  tenantId: number,
): Promise<void> {
  const state = await lockExtensionSipAuth(client, extensionId, tenantId, true, true);
  if (state.subscriberPresent) {
    throw new Error("Suspended extension still has a SIP subscriber credential.");
  }
  const creds = regenerateSipCredentials(state.username, state.domain, state.domain);
  if (state.accountId !== null) {
    const updated = await client.query(
      `UPDATE sip_accounts SET status='active', ha1=$1, ha1b=$2,
              secret_ciphertext=$3, secret_iv=$4, secret_tag=$5,
              dek_id=$6, updated_at=NOW()
        WHERE id=$7 AND extension_id=$8 AND tenant_id=$9
          AND status='suspended' AND deleted_at IS NULL RETURNING id`,
      [creds.ha1, creds.ha1b, creds.secretCiphertext, creds.secretIv,
        creds.secretTag, creds.dekId, state.accountId, extensionId, tenantId],
    );
    if (updated.rows.length !== 1) throw new Error("SIP account changed before reactivation.");
  } else {
    await client.query(
      `UPDATE extensions SET sip_password=$1 WHERE id=$2 AND tenant_id=$3`,
      [creds.plaintextPassword, extensionId, tenantId],
    );
  }
  const inserted = await client.query(
    `INSERT INTO subscriber(username, domain, password, ha1, ha1b)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(username, domain) DO NOTHING RETURNING username`,
    [state.username, state.domain, creds.plaintextPassword, creds.ha1, creds.ha1b],
  );
  if (inserted.rows.length !== 1) throw new Error("SIP subscriber changed before reactivation.");
}

async function lockExtensionSipAuth(client: PoolClient, extensionId: number, tenantId: number,
  allowCredentialFree = false, allowSuspendedAccount = false) {
  const ext = await client.query(
    `SELECT id, extension_number, sip_username, sip_domain, sip_password
       FROM extensions WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
    [extensionId, tenantId],
  );
  if (ext.rows.length !== 1) throw new Error("Extension is not available in this workspace.");
  const accounts = await client.query(
    `SELECT id, sip_username, sip_domain, ha1, ha1b FROM sip_accounts
      WHERE extension_id = $1 AND tenant_id = $2 AND status = ANY($3::text[])
        AND deleted_at IS NULL LIMIT 2 FOR UPDATE`,
    [extensionId, tenantId, allowSuspendedAccount ? ['suspended'] : ['active']],
  );
  if (accounts.rows.length > 1) throw new Error("Extension has multiple active SIP accounts.");
  const account = accounts.rows[0];
  const username = account?.sip_username || ext.rows[0].sip_username || ext.rows[0].extension_number;
  const domain = account?.sip_domain || ext.rows[0].sip_domain || DEFAULT_SIP_DOMAIN;
  if (!username || !domain ||
      (account && ((ext.rows[0].sip_username || ext.rows[0].extension_number) !== username ||
        (ext.rows[0].sip_domain || DEFAULT_SIP_DOMAIN) !== domain))) {
    throw new Error("SIP account identity does not match its extension.");
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [username, domain]);
  const foreign = await client.query(
    `SELECT (
       EXISTS (SELECT 1 FROM extensions e WHERE e.deleted_at IS NULL
                 AND e.id <> $3 AND COALESCE(NULLIF(e.sip_username, ''), e.extension_number) = $1
                 AND COALESCE(NULLIF(e.sip_domain, ''), $2) = $2)
       OR EXISTS (SELECT 1 FROM sip_accounts sa WHERE sa.deleted_at IS NULL
                 AND sa.extension_id IS DISTINCT FROM $3
                 AND sa.sip_username = $1 AND sa.sip_domain = $2)
     ) AS has_conflict`,
    [username, domain, extensionId],
  );
  if (foreign.rows.length !== 1 || foreign.rows[0].has_conflict !== false) {
    throw new Error("SIP username is used by another phone account.");
  }
  const subscriber = await client.query(
    `SELECT ha1, ha1b FROM subscriber WHERE username = $1 AND domain = $2 FOR UPDATE`,
    [username, domain],
  );
  if (subscriber.rows.length > 1) throw new Error("SIP subscriber identity is ambiguous.");
  const ha1 = account?.ha1 || (ext.rows[0].sip_password
    ? computeHA1(username, domain, ext.rows[0].sip_password) : null);
  const ha1b = account?.ha1b || (ext.rows[0].sip_password
    ? computeHA1B(username, domain, domain, ext.rows[0].sip_password) : null);
  if (subscriber.rows.length === 1 && (!ha1 || !ha1b ||
      subscriber.rows[0].ha1 !== ha1 || subscriber.rows[0].ha1b !== ha1b)) {
    throw new Error("SIP subscriber credentials do not match this extension.");
  }
  if (!account && !ext.rows[0].sip_password && (!allowCredentialFree || subscriber.rows.length !== 0)) {
    throw new Error("Legacy extension has no verifiable SIP credential.");
  }
  return { accountId: account?.id ?? null, username, domain, ha1, ha1b,
    subscriberPresent: subscriber.rows.length === 1 };
}

/**
 * Pilot bootstrap for first-device tests. This still provisions on the server side
 * and returns the same admin-controlled SIP config as getPhoneConfig.
 */
export async function ensurePilotExtensionForUser(userId: number, openId: string): Promise<PhoneConfig> {
  const existing = await getPhoneConfig(userId, openId);
  if (existing.configured) return existing;

  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  // Pilot bootstrap must not revive an inactive member by handing out a fresh
  // extension and its SIP credentials.
  const membership = await db.query(`SELECT 1 FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
    WHERE tm.user_id=$1 AND tm.tenant_id=1 AND tm.status='active' AND t.status='active' LIMIT 1`, [userId]);
  if (membership.rows.length !== 1) return { configured: false };

  const openExtension = await db.query(`
    SELECT e.*
    FROM extensions e
    LEFT JOIN user_extensions ue ON ue.extension_id = e.id
    LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.deleted_at IS NULL
    WHERE e.tenant_id = 1
      AND COALESCE(e.status, 'active') = 'active'
      AND e.deleted_at IS NULL
      AND e.user_id IS NULL
      AND ue.user_id IS NULL
      AND (sa.user_id IS NULL OR sa.user_id = 0)
    ORDER BY e.extension_number
    LIMIT 1
  `);

  if (openExtension.rows.length > 0) {
    const ext = openExtension.rows[0];
    await assignExtensionToUser(userId, ext.id, true, 1);
    return getPhoneConfig(userId, openId);
  }

  const extensionNumber = await getNextPilotExtensionNumber(db);
  const created = await createExtension({
    orgId: 1,
    extensionNumber,
    displayName: `Phone11 Pilot ${extensionNumber}`,
  });
  await assignExtensionToUser(userId, created.id, true, 1);

  return getPhoneConfig(userId, openId);
}

/**
 * Assign an extension to a user.
 */
export async function assignExtensionToUser(
  userId: number,
  extensionId: number,
  isPrimary: boolean = true,
  tenantId: number = 1,
  actorUserId?: number,
) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  await withTransaction(async (client) => {
    if (actorUserId !== undefined) await lockLegacyPhoneAdmin(client, actorUserId, tenantId);
    const assignee = await client.query(
      `SELECT tm.user_id FROM tenant_memberships tm
         JOIN tenants t ON t.id=tm.tenant_id
        WHERE tm.user_id=$1 AND tm.tenant_id=$2
          AND tm.status='active' AND t.status='active'
        FOR UPDATE OF tm, t`,
      [userId, tenantId],
    );
    if (assignee.rows.length !== 1) {
      throw new Error("Extension assignee must be an active member of this workspace.");
    }
    // Serialize reassignment of this extension with ownership reads. The
    // former assignee's link is removed in the same transaction as both
    // authoritative owner fields change.
    const eligible = await client.query(
      `SELECT e.id, e.user_id
         FROM extensions e
         JOIN tenant_memberships tm
           ON tm.user_id = $1 AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
         JOIN tenants t ON t.id = e.tenant_id AND t.status = 'active'
        WHERE e.id = $2 AND e.tenant_id = $3
          AND e.status = 'active' AND e.deleted_at IS NULL
        LIMIT 1 FOR UPDATE OF e`,
      [userId, extensionId, tenantId],
    );
    if (eligible.rows.length !== 1) {
      throw new Error("Extension assignee must be an active member of this workspace.");
    }
    if (eligible.rows[0].user_id !== userId) {
      await rotateExtensionSipAuth(client, extensionId, tenantId);
    }

    await client.query(
      `DELETE FROM user_extensions WHERE extension_id = $1 AND user_id <> $2`,
      [extensionId, userId],
    );
    if (isPrimary) {
      await client.query(
        `UPDATE user_extensions ue SET is_primary = false
           FROM extensions e
          WHERE ue.user_id = $1 AND ue.extension_id = e.id AND e.tenant_id = $2`,
        [userId, tenantId],
      );
    }

    await client.query(`
      INSERT INTO user_extensions (user_id, extension_id, is_primary)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, extension_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
    `, [userId, extensionId, isPrimary]);

    await client.query(
      `UPDATE extensions SET user_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [userId, extensionId, tenantId],
    );
    await client.query(
      `UPDATE sip_accounts SET user_id = $1, updated_at = NOW()
        WHERE extension_id = $2 AND tenant_id = $3`,
      [userId, extensionId, tenantId],
    );
  });

  return { success: true };
}

/**
 * List all extensions for an organization.
 */
export async function listExtensions(orgId: number) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const result = await db.query(`
    SELECT e.*, ue.user_id as assigned_user_id
    FROM extensions e
    LEFT JOIN user_extensions ue ON e.id = ue.extension_id
    WHERE e.tenant_id = $1
      AND e.deleted_at IS NULL
    ORDER BY e.extension_number
  `, [orgId]);
  return result.rows.map(({ sip_password, password, ...safe }: {
    sip_password?: string; password?: string;
  }) => safe);
}

/**
 * Create a new extension, SIP account, and Kamailio subscriber.
 */
export async function createExtension(input: {
  orgId: number;
  extensionNumber: string;
  displayName?: string;
  actorUserId?: number;
}) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const { orgId, extensionNumber, displayName } = input;
  return withTransaction(async (client) => {
    if (input.actorUserId !== undefined) await lockLegacyPhoneAdmin(client, input.actorUserId, orgId);
    // Kamailio subscriber usernames are global in this legacy schema. The
    // transaction-scoped lock makes the ownership check and credential write
    // indivisible across tenants, while the transaction rolls back a subscriber
    // change if either local provisioning insert fails.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [extensionNumber, DEFAULT_SIP_DOMAIN],
    );
    const conflictingExtension = await client.query(
      `SELECT id, tenant_id FROM extensions
        WHERE extension_number = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [extensionNumber],
    );
    if (conflictingExtension.rows.length > 0) {
      throw new Error(conflictingExtension.rows[0].tenant_id === orgId
        ? "This extension number is already in use by this workspace."
        : "This extension number is already in use by another workspace.");
    }

    const creds = createSipCredentials(extensionNumber, DEFAULT_SIP_DOMAIN, DEFAULT_SIP_DOMAIN);
    const subscriber = await client.query(`
      INSERT INTO subscriber (username, domain, password, ha1, ha1b)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (username, domain) DO NOTHING
      RETURNING username
    `, [extensionNumber, DEFAULT_SIP_DOMAIN, creds.plaintextPassword, creds.ha1, creds.ha1b]);
    if (subscriber.rows.length !== 1) {
      throw new Error("This SIP username already has a subscriber account.");
    }

    const result = await client.query(`
      INSERT INTO extensions (
        org_id, tenant_id, extension_number, sip_username, sip_domain, sip_password,
        display_name, transport, status, type
      )
      VALUES ($1, $1, $2, $2, $3, $4, $5, $6, 'active', 'user')
      RETURNING *
    `, [orgId, extensionNumber, DEFAULT_SIP_DOMAIN, creds.plaintextPassword, displayName || `Extension ${extensionNumber}`, DEFAULT_SIP_TRANSPORT]);

    const ext = result.rows[0];
    await client.query(`
      INSERT INTO sip_accounts (
        tenant_id, org_id, extension_id, sip_username, sip_domain, ha1, ha1b,
        secret_ciphertext, secret_iv, secret_tag, dek_id, transport_preference, status
      )
      VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
    `, [
      orgId,
      ext.id,
      creds.sipUsername,
      creds.sipDomain,
      creds.ha1,
      creds.ha1b,
      creds.secretCiphertext,
      creds.secretIv,
      creds.secretTag,
      creds.dekId,
      DEFAULT_SIP_TRANSPORT,
    ]);

    const { sip_password, password: legacyPassword, ...safeExtension } = ext;
    return safeExtension;
  });
}

async function lockLegacyPhoneAdmin(client: PoolClient, actorUserId: number, tenantId: number): Promise<void> {
  const actor = await client.query(
    `SELECT tm.role FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id
      WHERE tm.user_id = $1 AND tm.tenant_id = $2
        AND tm.status = 'active' AND tm.role IN ('owner', 'admin')
        AND t.status = 'active'
      FOR UPDATE OF tm, t`,
    [actorUserId, tenantId],
  );
  if (actor.rows.length !== 1) throw new Error("Workspace administrator access is required.");
}

/**
 * List all organizations.
 */
export async function listOrganizations(tenantIds: number[]) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const result = await db.query(`SELECT * FROM organizations WHERE id = ANY($1::integer[]) ORDER BY id`, [tenantIds]);
  return result.rows;
}

/**
 * List DID numbers for an organization.
 */
export async function listDidNumbers(orgId: number) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const result = await db.query(`
    SELECT * FROM did_numbers WHERE tenant_id = $1 ORDER BY number
  `, [orgId]);
  return result.rows;
}

/**
 * Create a new DID number.
 */
export async function createDidNumber(input: {
  orgId: number;
  number: string;
  description?: string;
  destinationType: string;
  destinationValue?: string;
}) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const result = await db.query(`
    INSERT INTO did_numbers (org_id, tenant_id, number, description, destination_type, destination_value, status)
    VALUES ($1, $1, $2, $3, $4, $5, 'active')
    RETURNING *
  `, [input.orgId, input.number, input.description || "", input.destinationType, input.destinationValue || ""]);
  return result.rows[0];
}
