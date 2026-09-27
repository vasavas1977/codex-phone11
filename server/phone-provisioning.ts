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

import { getPool, withTransaction } from "./pbx/db";
import { createSipCredentials, computeHA1, computeHA1B, decryptSecret } from "./pbx/sip-secrets";

export interface PhoneConfig {
  configured: boolean;
  extension?: {
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
  const ha1 = computeHA1(username, domain, password);
  const ha1b = computeHA1B(username, domain, domain, password);
  if (row.subscriber_ha1 !== ha1 || row.subscriber_ha1b !== ha1b) return null;

  if (row.account_id != null) {
    if (row.sip_username !== username || (row.sip_domain || DEFAULT_SIP_DOMAIN) !== domain ||
        row.account_ha1 !== ha1 || row.account_ha1b !== ha1b) return null;
    const ciphertext = toBuffer(row.secret_ciphertext);
    const iv = toBuffer(row.secret_iv);
    const tag = toBuffer(row.secret_tag);
    if (!ciphertext || !iv || !tag) return null;
    try {
      return decryptSecret(ciphertext, iv, tag) === password ? password : null;
    } catch {
      return null;
    }
  }

  // Only extensions without any account may use their legacy password.
  return row.sip_password === password ? password : null;
}

function buildConfig(ext: any, password: string, dids: Array<{ number: string; description: string }> = []): PhoneConfig {
  const transport = normalizeSipTransport(ext.transport_preference || ext.transport);
  const sipDomain = ext.account_sip_domain || ext.sip_domain || DEFAULT_SIP_DOMAIN;
  const sipUsername = ext.account_sip_username || ext.sip_username || ext.extension_number;

  return {
    configured: true,
    extension: {
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
      LEFT JOIN subscriber sub ON sub.username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
        AND sub.domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $2)
      WHERE e.type = 'user'
        AND ((sa.id IS NOT NULL AND e.user_id = $1 AND sa.user_id = $1 AND ue.user_id = $1)
          OR (sa.id IS NULL AND e.user_id = $1 AND ue.user_id = $1))
        AND COALESCE(e.status, 'active') = 'active'
        AND e.deleted_at IS NULL
        AND (sa.id IS NULL OR (sa.status = 'active' AND sa.deleted_at IS NULL))
        AND (SELECT COUNT(*) FROM sip_accounts accounts_for_extension
             WHERE accounts_for_extension.extension_id = e.id
               AND accounts_for_extension.tenant_id = e.tenant_id) <= 1
        AND (sa.id IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM sip_accounts any_account WHERE any_account.extension_id = e.id
        ))
        AND NOT EXISTS (
          SELECT 1 FROM extensions other_e WHERE other_e.id <> e.id AND other_e.deleted_at IS NULL
            AND COALESCE(NULLIF(other_e.sip_username, ''), other_e.extension_number) =
              COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
            AND COALESCE(NULLIF(other_e.sip_domain, ''), $2) =
              COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $2)
        )
        AND NOT EXISTS (
          SELECT 1 FROM sip_accounts other_sa WHERE other_sa.id IS DISTINCT FROM sa.id
            AND other_sa.status = 'active' AND other_sa.deleted_at IS NULL
            AND other_sa.sip_username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
            AND other_sa.sip_domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $2)
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
        WHERE COALESCE(org_id, tenant_id, 1) = $1
          AND destination_type = 'extension'
          AND destination_value = $2
          AND COALESCE(status, 'active') = 'active'
      `, [ext.org_id || ext.tenant_id || 1, ext.extension_number]);

      return buildConfig(
        ext,
        password,
        didsResult.rows.map((d: any) => ({
          number: d.number,
          description: d.description || "",
        })),
      );
    }

    const isOwner = process.env.OWNER_OPEN_ID && openId === process.env.OWNER_OPEN_ID;

    if (isOwner) {
      const ownerExt = await db.query(`
        SELECT e.*, o.name as org_name, o.plan as org_plan,
               t.name as tenant_name, t.plan as tenant_plan,
               sa.id as account_id, sa.sip_username as account_sip_username,
               sa.sip_domain as account_sip_domain, sa.ha1 as account_ha1,
               sa.ha1b as account_ha1b, sa.secret_ciphertext, sa.secret_iv,
               sa.secret_tag, sa.transport_preference,
               sub.password as subscriber_password, sub.ha1 as subscriber_ha1,
               sub.ha1b as subscriber_ha1b
        FROM extensions e
        JOIN tenant_memberships owner_tm ON owner_tm.user_id = $2
          AND owner_tm.tenant_id = e.tenant_id AND owner_tm.status = 'active'
        JOIN tenants owner_tenant ON owner_tenant.id = e.tenant_id AND owner_tenant.status = 'active'
        LEFT JOIN organizations o ON COALESCE(e.org_id, 1) = o.id
        LEFT JOIN tenants t ON COALESCE(e.tenant_id, e.org_id, 1) = t.id
        LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
        LEFT JOIN subscriber sub ON sub.username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
          AND sub.domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $1)
        WHERE (e.sip_username = '1020' OR e.extension_number = '1020')
          AND e.tenant_id = 1
          AND (e.user_id IS NULL OR e.user_id = $2)
          AND (sa.id IS NULL OR sa.user_id IS NULL OR sa.user_id = $2)
          AND COALESCE(e.status, 'active') = 'active'
          AND e.deleted_at IS NULL
          AND (sa.id IS NULL OR (sa.status = 'active' AND sa.deleted_at IS NULL))
          AND (SELECT COUNT(*) FROM sip_accounts accounts_for_extension
               WHERE accounts_for_extension.extension_id = e.id
                 AND accounts_for_extension.tenant_id = e.tenant_id) <= 1
          AND (sa.id IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM sip_accounts any_account WHERE any_account.extension_id = e.id
          ))
          AND NOT EXISTS (
            SELECT 1 FROM extensions other_e WHERE other_e.id <> e.id AND other_e.deleted_at IS NULL
              AND COALESCE(NULLIF(other_e.sip_username, ''), other_e.extension_number) =
                COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
              AND COALESCE(NULLIF(other_e.sip_domain, ''), $1) =
                COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM sip_accounts other_sa WHERE other_sa.id IS DISTINCT FROM sa.id
              AND other_sa.status = 'active' AND other_sa.deleted_at IS NULL
              AND other_sa.sip_username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
              AND other_sa.sip_domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $1)
          )
          AND (SELECT COUNT(*) FROM subscriber matching_sub
            WHERE matching_sub.username = COALESCE(NULLIF(sa.sip_username, ''), NULLIF(e.sip_username, ''), e.extension_number)
              AND matching_sub.domain = COALESCE(NULLIF(sa.sip_domain, ''), NULLIF(e.sip_domain, ''), $1)) = 1
        LIMIT 1
      `, [DEFAULT_SIP_DOMAIN, userId]);

      if (ownerExt.rows.length > 0) {
        const ext = ownerExt.rows[0];
        const password = getSipPassword(ext);
        if (!password) return { configured: false };
        await assignExtensionToUser(userId, ext.id, true);
        return buildConfig({ ...ext, display_name: ext.display_name || "Owner" }, password);
      }
    }

    return { configured: false };
  } catch (error) {
    console.error("[PhoneProvisioning] getPhoneConfig error:", error);
    throw error;
  }
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

  // A login alone does not authorize allocating tenant-1 calling resources.
  const membership = await db.query(`
    SELECT 1 FROM tenant_memberships tm
    JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
    WHERE tm.user_id = $1 AND tm.tenant_id = 1 AND tm.status = 'active'
    LIMIT 1
  `, [userId]);
  if (membership.rows.length !== 1) return { configured: false };

  const openExtension = await db.query(`
    SELECT e.*
    FROM extensions e
    LEFT JOIN user_extensions ue ON ue.extension_id = e.id
    LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.deleted_at IS NULL
    WHERE COALESCE(e.org_id, e.tenant_id, 1) = 1
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
    await assignExtensionToUser(userId, ext.id, true);
    return getPhoneConfig(userId, openId);
  }

  const extensionNumber = await getNextPilotExtensionNumber(db);
  const created = await createExtension({
    orgId: 1,
    extensionNumber,
    displayName: `Phone11 Pilot ${extensionNumber}`,
  });
  await assignExtensionToUser(userId, created.id, true);

  return getPhoneConfig(userId, openId);
}

/**
 * Assign an extension to a user.
 */
export async function assignExtensionToUser(userId: number, extensionId: number, isPrimary: boolean = true) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);
  await withTransaction(async (client) => {
    const extension = await client.query(
      `SELECT id, tenant_id, user_id FROM extensions WHERE id = $1 AND type = 'user'
         AND status = 'active' AND deleted_at IS NULL FOR UPDATE`,
      [extensionId],
    );
    if (extension.rows.length !== 1) throw new Error("The extension is unavailable.");
    if (extension.rows[0].user_id !== null && extension.rows[0].user_id !== userId) {
      throw new Error("The extension is already assigned to another user.");
    }
    const tenantId = extension.rows[0].tenant_id;
    const eligible = await client.query(
      `SELECT 1 FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id
         AND t.status = 'active' WHERE tm.user_id = $1 AND tm.tenant_id = $2
         AND tm.status = 'active' LIMIT 1`,
      [userId, tenantId],
    );
    if (eligible.rows.length !== 1) {
      throw new Error("Extension assignee must be an active member of this workspace.");
    }
    const accounts = await client.query(
      `SELECT id FROM sip_accounts WHERE extension_id = $1 AND tenant_id = $2
         AND status = 'active' AND deleted_at IS NULL FOR UPDATE`,
      [extensionId, tenantId],
    );
    const allAccounts = await client.query(
      `SELECT COUNT(*)::integer AS count FROM sip_accounts WHERE extension_id = $1`,
      [extensionId],
    );
    if (accounts.rows.length > 1 || allAccounts.rows[0]?.count !== accounts.rows.length) {
      throw new Error("The extension has ambiguous SIP accounts.");
    }
    if (isPrimary) {
      await client.query(
        `UPDATE user_extensions ue SET is_primary = false FROM extensions e
           WHERE ue.extension_id = e.id AND ue.user_id = $1 AND e.tenant_id = $2`,
        [userId, tenantId],
      );
    }
    await client.query(`DELETE FROM user_extensions WHERE extension_id = $1`, [extensionId]);
    const updated = await client.query(
      `UPDATE extensions SET user_id = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND status = 'active'
           AND deleted_at IS NULL RETURNING id`,
      [userId, extensionId, tenantId],
    );
    if (updated.rows.length !== 1) throw new Error("The extension assignment changed.");
    if (accounts.rows.length === 1) {
      const accountUpdate = await client.query(
        `UPDATE sip_accounts SET user_id = $1, updated_at = NOW()
           WHERE id = $2 AND extension_id = $3 AND tenant_id = $4
             AND status = 'active' AND deleted_at IS NULL RETURNING id`,
        [userId, accounts.rows[0].id, extensionId, tenantId],
      );
      if (accountUpdate.rows.length !== 1) throw new Error("The SIP account assignment changed.");
    }
    await client.query(
      `INSERT INTO user_extensions (user_id, extension_id, is_primary) VALUES ($1, $2, $3)`,
      [userId, extensionId, isPrimary],
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
    WHERE COALESCE(e.org_id, e.tenant_id, 1) = $1
      AND e.deleted_at IS NULL
    ORDER BY e.extension_number
  `, [orgId]);
  return result.rows.map((extension: Record<string, unknown>) => {
    const safe = { ...extension };
    delete safe.sip_password;
    return safe;
  });
}

/**
 * Create a new extension, SIP account, and Kamailio subscriber.
 */
export async function createExtension(input: {
  orgId: number;
  extensionNumber: string;
  displayName?: string;
  password?: string;
}) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const { orgId, extensionNumber, displayName, password } = input;
  return withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [extensionNumber, DEFAULT_SIP_DOMAIN],
    );
    const existing = await client.query(
      `SELECT id FROM subscriber WHERE username = $1 AND domain = $2`,
      [extensionNumber, DEFAULT_SIP_DOMAIN],
    );
    const extension = await client.query(
      `SELECT id FROM extensions WHERE extension_number = $1 AND deleted_at IS NULL LIMIT 1`,
      [extensionNumber],
    );
    const account = await client.query(
      `SELECT id FROM sip_accounts WHERE sip_username = $1 AND sip_domain = $2
         AND deleted_at IS NULL LIMIT 1`,
      [extensionNumber, DEFAULT_SIP_DOMAIN],
    );
    if (existing.rows.length || extension.rows.length || account.rows.length) {
      throw new Error("This SIP address is already in use.");
    }

    const creds = createSipCredentials(extensionNumber, DEFAULT_SIP_DOMAIN, DEFAULT_SIP_DOMAIN, password);
    await client.query(`
      INSERT INTO subscriber (username, domain, password, ha1, ha1b)
      VALUES ($1, $2, $3, $4, $5)
    `, [extensionNumber, DEFAULT_SIP_DOMAIN, creds.plaintextPassword, creds.ha1, creds.ha1b]);

    const result = await client.query(`
    INSERT INTO extensions (
      org_id, tenant_id, extension_number, sip_username, sip_domain, sip_password,
      display_name, transport, status, type
    )
    VALUES ($1, $1, $2, $2, $3, NULL, $4, $5, 'active', 'user')
    RETURNING *
  `, [orgId, extensionNumber, DEFAULT_SIP_DOMAIN, displayName || `Extension ${extensionNumber}`, DEFAULT_SIP_TRANSPORT]);

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

    const safe = { ...ext };
    delete safe.sip_password;
    return safe;
  });
}

/**
 * List all organizations.
 */
export async function listOrganizations() {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const result = await db.query(`SELECT * FROM organizations ORDER BY id`);
  return result.rows;
}

/**
 * List DID numbers for an organization.
 */
export async function listDidNumbers(orgId: number) {
  const db = getPool();
  await ensurePhoneProvisioningSchema(db);

  const result = await db.query(`
    SELECT * FROM did_numbers WHERE COALESCE(org_id, tenant_id, 1) = $1 ORDER BY number
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
