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

import { getPool } from "./pbx/db";
import { createSipCredentials, decryptSecret } from "./pbx/sip-secrets";

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

function getSipPassword(row: any): string {
  const ciphertext = toBuffer(row.secret_ciphertext);
  const iv = toBuffer(row.secret_iv);
  const tag = toBuffer(row.secret_tag);

  if (ciphertext && iv && tag) {
    try {
      return decryptSecret(ciphertext, iv, tag);
    } catch (error) {
      console.warn("[PhoneProvisioning] Could not decrypt SIP secret, falling back to extension password");
    }
  }

  return row.sip_password || row.password || "";
}

function buildConfig(ext: any, dids: Array<{ number: string; description: string }> = []): PhoneConfig {
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
      password: getSipPassword(ext),
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
    "ADD COLUMN IF NOT EXISTS sip_domain VARCHAR(128) DEFAULT '${DEFAULT_SIP_DOMAIN}'",
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
             sa.sip_username as account_sip_username, sa.sip_domain as account_sip_domain,
             sa.secret_ciphertext, sa.secret_iv, sa.secret_tag, sa.transport_preference
      FROM extensions e
      LEFT JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = $1
      LEFT JOIN organizations o ON COALESCE(e.org_id, 1) = o.id
      LEFT JOIN tenants t ON COALESCE(e.tenant_id, e.org_id, 1) = t.id
      LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.deleted_at IS NULL
      WHERE (ue.user_id = $1 OR e.user_id = $1 OR sa.user_id = $1)
        AND COALESCE(e.status, 'active') = 'active'
        AND e.deleted_at IS NULL
      ORDER BY ue.is_primary DESC NULLS LAST, e.id ASC
      LIMIT 1
    `, [userId]);

    if (assignedResult.rows.length > 0) {
      const ext = assignedResult.rows[0];
      const didsResult = await db.query(`
        SELECT number, description FROM did_numbers
        WHERE COALESCE(org_id, tenant_id, 1) = $1
          AND destination_type = 'extension'
          AND destination_value = $2
          AND COALESCE(status, 'active') = 'active'
      `, [ext.org_id || ext.tenant_id || 1, ext.extension_number]);

      return buildConfig(
        ext,
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
               sa.sip_username as account_sip_username, sa.sip_domain as account_sip_domain,
               sa.secret_ciphertext, sa.secret_iv, sa.secret_tag, sa.transport_preference
        FROM extensions e
        LEFT JOIN organizations o ON COALESCE(e.org_id, 1) = o.id
        LEFT JOIN tenants t ON COALESCE(e.tenant_id, e.org_id, 1) = t.id
        LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.deleted_at IS NULL
        WHERE (e.sip_username = '1020' OR e.extension_number = '1020')
          AND COALESCE(e.status, 'active') = 'active'
          AND e.deleted_at IS NULL
        LIMIT 1
      `);

      if (ownerExt.rows.length > 0) {
        const ext = ownerExt.rows[0];
        await assignExtensionToUser(userId, ext.id, true);
        return buildConfig({ ...ext, display_name: ext.display_name || "Owner" });
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

  if (isPrimary) {
    await db.query(`UPDATE user_extensions SET is_primary = false WHERE user_id = $1`, [userId]);
  }

  await db.query(`
    INSERT INTO user_extensions (user_id, extension_id, is_primary)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, extension_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
  `, [userId, extensionId, isPrimary]);

  await db.query(`UPDATE extensions SET user_id = $1, updated_at = NOW() WHERE id = $2`, [userId, extensionId]);
  await db.query(`UPDATE sip_accounts SET user_id = $1, updated_at = NOW() WHERE extension_id = $2`, [userId, extensionId]);

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
  return result.rows;
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
  const creds = createSipCredentials(extensionNumber, DEFAULT_SIP_DOMAIN, DEFAULT_SIP_DOMAIN, password);

  await db.query(`
    INSERT INTO subscriber (username, domain, password, ha1, ha1b)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (username, domain) DO UPDATE SET
      password = EXCLUDED.password,
      ha1 = EXCLUDED.ha1,
      ha1b = EXCLUDED.ha1b
  `, [extensionNumber, DEFAULT_SIP_DOMAIN, creds.plaintextPassword, creds.ha1, creds.ha1b]);

  const result = await db.query(`
    INSERT INTO extensions (
      org_id, tenant_id, extension_number, sip_username, sip_domain, sip_password,
      display_name, transport, status, type
    )
    VALUES ($1, $1, $2, $2, $3, $4, $5, $6, 'active', 'user')
    RETURNING *
  `, [orgId, extensionNumber, DEFAULT_SIP_DOMAIN, creds.plaintextPassword, displayName || `Extension ${extensionNumber}`, DEFAULT_SIP_TRANSPORT]);

  const ext = result.rows[0];

  await db.query(`
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

  return ext;
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
