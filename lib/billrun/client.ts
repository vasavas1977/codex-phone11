/**
 * BillRun API Client — CloudPhone11
 *
 * Integrates with BillRun Open Source BSS REST API.
 * Docs: https://docs.bill.run/en/api/5
 *
 * Base URL: BILLRUN_API_URL (set in app secrets)
 * Auth: BILLRUN_API_KEY (set in app secrets)
 *
 * Endpoints used:
 *  GET  /billapi/accounts       — Account balance & credit limit
 *  GET  /billapi/bills          — Invoice history
 *  GET  /billapi/lines          — CDR usage lines
 *  GET  /billapi/subscribers    — Subscriber (user) info
 *  POST /billapi/autorenew      — Create/update subscription autorenew
 *  GET  /billapi/plans          — Available service plans
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CONFIG_KEY = "cloudphone11_billrun_config";

export interface BillRunConfig {
  baseUrl: string;   // e.g. https://billing.yourcompany.com
  apiKey: string;    // BillRun API secret key
  accountId?: string; // Your BillRun account/subscriber ID
}

// ─── Default config (update with your real BillRun server) ───────────────────
const DEFAULT_CONFIG: BillRunConfig = {
  baseUrl: process.env.EXPO_PUBLIC_BILLRUN_API_URL ?? "https://billing.yourcompany.com",
  apiKey: process.env.EXPO_PUBLIC_BILLRUN_API_KEY ?? "",
  accountId: process.env.EXPO_PUBLIC_BILLRUN_ACCOUNT_ID ?? "",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillRunAccount {
  aid: number;
  firstname: string;
  lastname: string;
  email: string;
  balance: number;
  credit: number;
  currency: string;
  status: string;
}

export interface BillRunInvoice {
  id: string;
  billrun_key: string;
  aid: number;
  invoice_id: number;
  due: number;
  total: number;
  due_date: string;
  invoice_date: string;
  status: "paid" | "unpaid" | "overdue";
}

export interface BillRunUsageLine {
  sid: number;
  type: string;       // "call", "sms", "data"
  usaget: string;     // usage type label
  volume: number;
  price: number;
  from: string;       // ISO date
  to: string;         // ISO date
  description: string;
}

export interface BillRunPlan {
  name: string;
  description: string;
  price: number;
  currency: string;
  period: string;
  services: string[];
}

// ─── Client ───────────────────────────────────────────────────────────────────

class BillRunClient {
  private config: BillRunConfig = DEFAULT_CONFIG;

  async loadConfig(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(CONFIG_KEY);
      if (raw) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // Use defaults
    }
  }

  async saveConfig(config: Partial<BillRunConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
  }

  getConfig(): BillRunConfig {
    return this.config;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    params?: Record<string, any>,
    body?: Record<string, any>
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BillRun API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Account ────────────────────────────────────────────────────────────────

  async getAccount(accountId?: string): Promise<BillRunAccount> {
    const aid = accountId ?? this.config.accountId;
    const result = await this.request<{ data: BillRunAccount[] }>("GET", "/billapi/accounts", {
      query: JSON.stringify({ aid: Number(aid) }),
      size: 1,
    });
    if (!result.data?.length) throw new Error("Account not found");
    return result.data[0];
  }

  // ─── Invoices ───────────────────────────────────────────────────────────────

  async getInvoices(accountId?: string, limit = 12): Promise<BillRunInvoice[]> {
    const aid = accountId ?? this.config.accountId;
    const result = await this.request<{ data: BillRunInvoice[] }>("GET", "/billapi/bills", {
      query: JSON.stringify({ aid: Number(aid) }),
      sort: JSON.stringify({ invoice_date: -1 }),
      size: limit,
    });
    return result.data ?? [];
  }

  // ─── CDR Usage Lines ────────────────────────────────────────────────────────

  async getUsageLines(accountId?: string, fromDate?: string, toDate?: string): Promise<BillRunUsageLine[]> {
    const aid = accountId ?? this.config.accountId;
    const now = new Date();
    const from = fromDate ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = toDate ?? now.toISOString();

    const result = await this.request<{ data: BillRunUsageLine[] }>("GET", "/billapi/lines", {
      query: JSON.stringify({
        aid: Number(aid),
        from: { $gte: from },
        to: { $lte: to },
      }),
      sort: JSON.stringify({ from: -1 }),
      size: 500,
    });
    return result.data ?? [];
  }

  // ─── Plans ──────────────────────────────────────────────────────────────────

  async getPlans(): Promise<BillRunPlan[]> {
    const result = await this.request<{ data: BillRunPlan[] }>("GET", "/billapi/plans", {
      size: 50,
    });
    return result.data ?? [];
  }

  // ─── Autorenew (subscriptions) ───────────────────────────────────────────────

  async createAutorenew(params: {
    accountId: string;
    planName: string;
    quantity?: number;
    description?: string;
  }): Promise<any> {
    return this.request("POST", "/billapi/autorenew", undefined, {
      aid: Number(params.accountId),
      plan: params.planName,
      quantity: params.quantity ?? 1,
      description: params.description ?? "",
    });
  }

  // ─── Health check ────────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      await this.request("GET", "/health", {});
      return true;
    } catch {
      return false;
    }
  }
}

export const billRunClient = new BillRunClient();
