/**
 * SIP Secret Management
 * 
 * Per Opus review critical item #1:
 * - HA1/HA1B stored for Kamailio digest auth (MD5 hash, not reversible)
 * - AES-256-GCM encrypted plaintext for one-time display at provisioning
 * - Envelope encryption with DEK (Data Encryption Key) identifier
 * - Never log or expose plaintext passwords in API responses
 * 
 * Flow:
 * 1. Generate random SIP password
 * 2. Compute HA1 = MD5(username:realm:password)
 * 3. Compute HA1B = MD5(username@domain:realm:password)
 * 4. Encrypt plaintext with AES-256-GCM
 * 5. Store ha1, ha1b, ciphertext, iv, tag, dek_id in sip_accounts
 * 6. On provisioning: decrypt once, return to user, mark as "displayed"
 */
import crypto from "crypto";

/** 
 * Data Encryption Key — in production, this should come from AWS KMS / GCP KMS.
 * For now, derive from environment variable with a fallback.
 */
const DEK_SECRET = process.env.SIP_DEK_SECRET || "phone11-sip-dek-v1-change-in-production";
const DEK_ID = "dek-v1";

function getDEK(): Buffer {
  return crypto.createHash("sha256").update(DEK_SECRET).digest();
}

export interface SipCredentials {
  sipUsername: string;
  sipDomain: string;
  ha1: string;
  ha1b: string;
  secretCiphertext: Buffer;
  secretIv: Buffer;
  secretTag: Buffer;
  dekId: string;
  plaintextPassword: string;  // Only available at creation time
}

/**
 * Generate a strong random SIP password
 */
export function generateSipPassword(length: number = 24): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b) => charset[b % charset.length])
    .join("");
}

/**
 * Compute HA1 digest: MD5(username:realm:password)
 * This is what Kamailio uses for SIP REGISTER authentication.
 */
export function computeHA1(username: string, realm: string, password: string): string {
  return crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
}

/**
 * Compute HA1B digest: MD5(username@domain:realm:password)
 * Used by some SIP clients that include domain in username.
 */
export function computeHA1B(username: string, domain: string, realm: string, password: string): string {
  return crypto.createHash("md5").update(`${username}@${domain}:${realm}:${password}`).digest("hex");
}

/**
 * Encrypt a plaintext password with AES-256-GCM
 */
export function encryptSecret(plaintext: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const key = getDEK();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  
  return { ciphertext: encrypted, iv, tag };
}

/**
 * Decrypt a secret from stored ciphertext
 */
export function decryptSecret(ciphertext: Buffer, iv: Buffer, tag: Buffer): string {
  const key = getDEK();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  
  return decrypted.toString("utf8");
}

/**
 * Create full SIP credentials for a new account.
 * Returns all fields needed for the sip_accounts table + plaintext for one-time display.
 */
export function createSipCredentials(
  sipUsername: string,
  sipDomain: string = "sip.phone11.ai",
  realm: string = "sip.phone11.ai",
  customPassword?: string
): SipCredentials {
  const password = customPassword || generateSipPassword();
  
  const ha1 = computeHA1(sipUsername, realm, password);
  const ha1b = computeHA1B(sipUsername, sipDomain, realm, password);
  const { ciphertext, iv, tag } = encryptSecret(password);
  
  return {
    sipUsername,
    sipDomain,
    ha1,
    ha1b,
    secretCiphertext: ciphertext,
    secretIv: iv,
    secretTag: tag,
    dekId: DEK_ID,
    plaintextPassword: password,
  };
}

/**
 * Regenerate SIP credentials (password reset).
 * Returns new credentials + plaintext for one-time display.
 */
export function regenerateSipCredentials(
  sipUsername: string,
  sipDomain: string = "sip.phone11.ai",
  realm: string = "sip.phone11.ai"
): SipCredentials {
  return createSipCredentials(sipUsername, sipDomain, realm);
}
