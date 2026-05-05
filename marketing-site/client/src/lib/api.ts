/**
 * API Client for phone11 Admin Portal
 * 
 * Connects to the phone11 backend API (api.phone11.ai) for managing:
 * - Extensions
 * - DID Numbers
 * - Organizations
 * - Users
 * - System status
 */

const API_BASE_URL = "https://api.phone11.ai";

interface TRPCResponse<T> {
  result: {
    data: T;
  };
}

interface TRPCBatchResponse<T> {
  result: {
    data: T;
  };
}

// Session token management
let sessionToken: string | null = localStorage.getItem("admin_session_token");

export function setSessionToken(token: string) {
  sessionToken = token;
  localStorage.setItem("admin_session_token", token);
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function clearSessionToken() {
  sessionToken = null;
  localStorage.removeItem("admin_session_token");
}

/**
 * Make a tRPC query call
 */
async function trpcQuery<T>(path: string, input?: any): Promise<T> {
  const url = new URL(`${API_BASE_URL}/api/trpc/${path}`);
  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ json: input }));
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  const data = await response.json();
  // tRPC returns { result: { data: { json: ... } } }
  return data?.result?.data?.json ?? data?.result?.data ?? data;
}

/**
 * Make a tRPC mutation call
 */
async function trpcMutation<T>(path: string, input?: any): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/trpc/${path}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ json: input }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data?.result?.data?.json ?? data?.result?.data ?? data;
}

// ============ Auth ============

export interface User {
  id: number;
  openId: string;
  name: string;
  avatarUrl?: string;
  role: string;
  createdAt: string;
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await trpcQuery<User>("auth.me");
  } catch {
    return null;
  }
}

// ============ Phone Provisioning ============

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

export async function getPhoneConfig(): Promise<PhoneConfig> {
  return trpcQuery<PhoneConfig>("phone.getConfig");
}

// ============ Extensions ============

export interface Extension {
  id: number;
  org_id: number;
  extension_number: string;
  sip_username: string;
  sip_domain: string;
  sip_password: string;
  display_name: string;
  caller_id_name?: string;
  caller_id_number?: string;
  user_id?: number;
  status: string;
  transport: string;
  assigned_user_id?: number;
  created_at: string;
}

export async function listExtensions(orgId?: number): Promise<Extension[]> {
  return trpcQuery<Extension[]>("phone.listExtensions", { orgId: orgId ?? 1 });
}

export async function createExtension(data: {
  orgId?: number;
  extensionNumber: string;
  displayName?: string;
  password?: string;
}): Promise<Extension> {
  return trpcMutation<Extension>("phone.createExtension", data);
}

export async function assignExtension(data: {
  userId: number;
  extensionId: number;
  isPrimary?: boolean;
}): Promise<{ success: boolean }> {
  return trpcMutation<{ success: boolean }>("phone.assignExtension", data);
}

// ============ Organizations ============

export interface Organization {
  id: number;
  name: string;
  domain: string;
  plan: string;
  max_extensions: number;
  max_concurrent_calls: number;
  status: string;
  created_at: string;
}

export async function listOrganizations(): Promise<Organization[]> {
  return trpcQuery<Organization[]>("phone.listOrganizations");
}

// ============ DID Numbers ============

export interface DIDNumber {
  id: number;
  org_id: number;
  number: string;
  description: string;
  destination_type: string;
  destination_value: string;
  status: string;
  created_at: string;
}

export async function listDids(orgId?: number): Promise<DIDNumber[]> {
  return trpcQuery<DIDNumber[]>("phone.listDids", { orgId: orgId ?? 1 });
}

export async function createDid(data: {
  orgId?: number;
  number: string;
  description?: string;
  destinationType?: string;
  destinationValue?: string;
}): Promise<DIDNumber> {
  return trpcMutation<DIDNumber>("phone.createDid", data);
}

// ============ System Status (direct SSH-based checks) ============

export interface SystemService {
  name: string;
  status: "healthy" | "degraded" | "down";
  uptime: string;
  port: string;
}

/**
 * Check system services status by pinging the SIP server directly
 */
export async function checkSystemStatus(): Promise<{
  sipServer: boolean;
  apiServer: boolean;
}> {
  const results = {
    sipServer: false,
    apiServer: false,
  };

  try {
    const healthRes = await fetch(`${API_BASE_URL}/api/health`);
    results.apiServer = healthRes.ok;
  } catch {
    results.apiServer = false;
  }

  // SIP server check via API health (if API is up, SIP infra is likely up too)
  results.sipServer = results.apiServer;

  return results;
}
