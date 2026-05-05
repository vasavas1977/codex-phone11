/**
 * Phone Provisioning Module
 * 
 * Handles SIP auto-provisioning for users after login.
 * Connects directly to the PostgreSQL database (same as Kamailio).
 * 
 * Flow:
 * 1. User logs in → app calls phone.getConfig
 * 2. Server looks up user's assigned extension
 * 3. If no extension assigned, auto-assigns the first available one (for owner/admin)
 * 4. Returns SIP credentials to the app
 */

import { getPool } from "./pbx/db";

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
    transport: string;
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

/**
 * Get phone configuration for a logged-in user.
 * Auto-assigns extension if user is owner and has no extension.
 */
export async function getPhoneConfig(userId: number, openId: string): Promise<PhoneConfig> {
  const db = getPool();

  try {
    // 1. Check if user has an assigned extension via user_extensions table
    const userExtResult = await db.query(`
      SELECT e.*, ue.is_primary, o.name as org_name, o.plan as org_plan, o.id as org_id
      FROM user_extensions ue
      JOIN extensions e ON ue.extension_id = e.id
      JOIN organizations o ON e.org_id = o.id
      WHERE ue.user_id = $1 AND e.status = 'active'
      ORDER BY ue.is_primary DESC
      LIMIT 1
    `, [userId]);

    if (userExtResult.rows.length > 0) {
      const ext = userExtResult.rows[0];
      
      // Get DIDs assigned to this extension
      const didsResult = await db.query(`
        SELECT number, description FROM did_numbers
        WHERE org_id = $1 AND destination_type = 'extension' AND destination_value = $2 AND status = 'active'
      `, [ext.org_id, ext.extension_number]);

      return {
        configured: true,
        extension: {
          number: ext.extension_number,
          displayName: ext.display_name || `Extension ${ext.extension_number}`,
          callerIdName: ext.caller_id_name,
          callerIdNumber: ext.caller_id_number,
        },
        sip: {
          username: ext.sip_username,
          password: ext.sip_password,
          domain: ext.sip_domain,
          port: 5060,
          transport: ext.transport || "UDP",
        },
        organization: {
          id: ext.org_id,
          name: ext.org_name,
          plan: ext.org_plan,
        },
        dids: didsResult.rows.map((d: any) => ({
          number: d.number,
          description: d.description || "",
        })),
      };
    }

    // 2. Check if user has extension assigned directly via extensions.user_id
    const directExtResult = await db.query(`
      SELECT e.*, o.name as org_name, o.plan as org_plan, o.id as org_id
      FROM extensions e
      JOIN organizations o ON e.org_id = o.id
      WHERE e.user_id = $1 AND e.status = 'active'
      LIMIT 1
    `, [userId]);

    if (directExtResult.rows.length > 0) {
      const ext = directExtResult.rows[0];
      
      // Auto-create user_extensions mapping
      await db.query(`
        INSERT INTO user_extensions (user_id, extension_id, is_primary)
        VALUES ($1, $2, true)
        ON CONFLICT DO NOTHING
      `, [userId, ext.id]);

      return {
        configured: true,
        extension: {
          number: ext.extension_number,
          displayName: ext.display_name || `Extension ${ext.extension_number}`,
          callerIdName: ext.caller_id_name,
          callerIdNumber: ext.caller_id_number,
        },
        sip: {
          username: ext.sip_username,
          password: ext.sip_password,
          domain: ext.sip_domain,
          port: 5060,
          transport: ext.transport || "UDP",
        },
        organization: {
          id: ext.org_id,
          name: ext.org_name,
          plan: ext.org_plan,
        },
        dids: [],
      };
    }

    // 3. For the owner/first user: auto-assign extension 1020
    // Check if this is the owner (first user or admin)
    const isOwner = process.env.OWNER_OPEN_ID && openId === process.env.OWNER_OPEN_ID;
    
    if (isOwner) {
      // Assign extension 1020 (the owner extension) to this user
      const ownerExt = await db.query(`
        SELECT e.*, o.name as org_name, o.plan as org_plan, o.id as org_id
        FROM extensions e
        JOIN organizations o ON e.org_id = o.id
        WHERE e.sip_username = '1020' AND e.status = 'active'
        LIMIT 1
      `);

      if (ownerExt.rows.length > 0) {
        const ext = ownerExt.rows[0];
        
        // Assign to user
        await db.query(`UPDATE extensions SET user_id = $1 WHERE id = $2`, [userId, ext.id]);
        await db.query(`
          INSERT INTO user_extensions (user_id, extension_id, is_primary)
          VALUES ($1, $2, true)
          ON CONFLICT DO NOTHING
        `, [userId, ext.id]);

        return {
          configured: true,
          extension: {
            number: ext.extension_number,
            displayName: ext.display_name || "Owner",
            callerIdName: ext.caller_id_name,
            callerIdNumber: ext.caller_id_number,
          },
          sip: {
            username: ext.sip_username,
            password: ext.sip_password,
            domain: ext.sip_domain,
            port: 5060,
            transport: ext.transport || "UDP",
          },
          organization: {
            id: ext.org_id,
            name: ext.org_name,
            plan: ext.org_plan,
          },
          dids: [],
        };
      }
    }

    // 4. No extension assigned — user needs admin to assign one
    return {
      configured: false,
    };
  } catch (error) {
    console.error("[PhoneProvisioning] getPhoneConfig error:", error);
    throw error;
  }
}

/**
 * Assign an extension to a user
 */
export async function assignExtensionToUser(userId: number, extensionId: number, isPrimary: boolean = true) {
  const db = getPool();

  // If setting as primary, unset other primaries first
  if (isPrimary) {
    await db.query(`UPDATE user_extensions SET is_primary = false WHERE user_id = $1`, [userId]);
  }

  await db.query(`
    INSERT INTO user_extensions (user_id, extension_id, is_primary)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
  `, [userId, extensionId, isPrimary]);

  // Also update extensions.user_id
  await db.query(`UPDATE extensions SET user_id = $1 WHERE id = $2`, [userId, extensionId]);

  return { success: true };
}

/**
 * List all extensions for an organization
 */
export async function listExtensions(orgId: number) {
  const db = getPool();
  const result = await db.query(`
    SELECT e.*, ue.user_id as assigned_user_id
    FROM extensions e
    LEFT JOIN user_extensions ue ON e.id = ue.extension_id
    WHERE e.org_id = $1
    ORDER BY e.extension_number
  `, [orgId]);
  return result.rows;
}

/**
 * Create a new extension (also creates SIP subscriber in Kamailio)
 */
export async function createExtension(input: {
  orgId: number;
  extensionNumber: string;
  displayName?: string;
  password?: string;
}) {
  const db = getPool();
  const { orgId, extensionNumber, displayName, password } = input;
  
  // Generate password if not provided
  const sipPassword = password || `Ph0ne11_${extensionNumber}_${Date.now().toString(36)}`;
  const sipDomain = "sip.phone11.ai";
  
  // Calculate HA1 for Kamailio: MD5(username:realm:password)
  const crypto = await import("crypto");
  const ha1 = crypto.createHash("md5").update(`${extensionNumber}:${sipDomain}:${sipPassword}`).digest("hex");
  const ha1b = crypto.createHash("md5").update(`${extensionNumber}@${sipDomain}:${sipDomain}:${sipPassword}`).digest("hex");

  // 1. Create SIP subscriber in Kamailio table
  await db.query(`
    INSERT INTO subscriber (username, domain, password, ha1, ha1b)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (username, domain) DO NOTHING
  `, [extensionNumber, sipDomain, sipPassword, ha1, ha1b]);

  // 2. Create extension record
  const result = await db.query(`
    INSERT INTO extensions (org_id, extension_number, sip_username, sip_domain, sip_password, display_name)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [orgId, extensionNumber, extensionNumber, sipDomain, sipPassword, displayName || `Extension ${extensionNumber}`]);

  return result.rows[0];
}

/**
 * List all organizations
 */
export async function listOrganizations() {
  const db = getPool();
  const result = await db.query(`SELECT * FROM organizations ORDER BY id`);
  return result.rows;
}

/**
 * List DID numbers for an organization
 */
export async function listDidNumbers(orgId: number) {
  const db = getPool();
  const result = await db.query(`
    SELECT * FROM did_numbers WHERE org_id = $1 ORDER BY number
  `, [orgId]);
  return result.rows;
}

/**
 * Create a new DID number
 */
export async function createDidNumber(input: {
  orgId: number;
  number: string;
  description?: string;
  destinationType: string;
  destinationValue?: string;
}) {
  const db = getPool();
  const result = await db.query(`
    INSERT INTO did_numbers (org_id, number, description, destination_type, destination_value)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [input.orgId, input.number, input.description || "", input.destinationType, input.destinationValue || ""]);
  return result.rows[0];
}
