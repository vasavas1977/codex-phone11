/**
 * DID Provisioning Client — CloudPhone11
 *
 * Supports multiple DID providers:
 *  - DIDww  (https://www.didww.com/api/)
 *  - DIDx   (https://www.didx.net/api/)
 *  - Custom inventory (your own number pool via REST API)
 *
 * Configure via app secrets:
 *  DID_PROVIDER_TYPE  = "didww" | "didx" | "custom"
 *  DID_PROVIDER_API_KEY
 *  DID_PROVIDER_API_URL  (for custom provider)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CONFIG_KEY = "cloudphone11_did_config";

export type DIDProviderType = "didww" | "didx" | "custom";

export interface DIDConfig {
  providerType: DIDProviderType;
  apiKey: string;
  apiUrl?: string;  // Required for custom provider
}

const DEFAULT_CONFIG: DIDConfig = {
  providerType: (process.env.EXPO_PUBLIC_DID_PROVIDER_TYPE as DIDProviderType) ?? "didww",
  apiKey: process.env.EXPO_PUBLIC_DID_PROVIDER_API_KEY ?? "",
  apiUrl: process.env.EXPO_PUBLIC_DID_PROVIDER_API_URL ?? "",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type DIDNumberType = "local" | "national" | "toll_free" | "mobile";

export interface AvailableDID {
  id: string;
  number: string;           // E.164 format, e.g. +12025551234
  countryCode: string;      // ISO 2-letter, e.g. "US"
  countryName: string;
  city?: string;
  region?: string;
  type: DIDNumberType;
  monthlyRate: number;      // USD per month
  setupFee: number;         // One-time setup fee
  currency: string;
  features: string[];       // e.g. ["voice", "sms", "fax"]
  available: boolean;
}

export interface MyDID {
  id: string;
  number: string;
  countryCode: string;
  countryName: string;
  type: DIDNumberType;
  monthlyRate: number;
  currency: string;
  status: "active" | "suspended" | "cancelled";
  assignedTo?: string;      // Extension or user
  forwardTo?: string;       // Forward destination
  activatedAt: string;      // ISO date
  renewsAt: string;         // ISO date
  features: string[];
}

export interface DIDPurchaseResult {
  success: boolean;
  did?: MyDID;
  error?: string;
  orderId?: string;
}

// ─── Provider Adapters ────────────────────────────────────────────────────────

const DIDWW_BASE = "https://api.didww.com/v3";
const DIDX_BASE = "https://www.didx.net/api/public/v1";

class DIDClient {
  private config: DIDConfig = DEFAULT_CONFIG;

  async loadConfig(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(CONFIG_KEY);
      if (raw) this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      // Use defaults
    }
  }

  async saveConfig(config: Partial<DIDConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
  }

  getConfig(): DIDConfig {
    return this.config;
  }

  // ─── Search available DID numbers ─────────────────────────────────────────

  async searchAvailable(params: {
    countryCode?: string;
    type?: DIDNumberType;
    city?: string;
    limit?: number;
  }): Promise<AvailableDID[]> {
    switch (this.config.providerType) {
      case "didww": return this._searchDIDWW(params);
      case "didx": return this._searchDIDX(params);
      case "custom": return this._searchCustom(params);
      default: return [];
    }
  }

  // ─── Get my active DIDs ───────────────────────────────────────────────────

  async getMyDIDs(): Promise<MyDID[]> {
    switch (this.config.providerType) {
      case "didww": return this._getMyDIDsWW();
      case "didx": return this._getMyDIDsDIDX();
      case "custom": return this._getMyDIDsCustom();
      default: return [];
    }
  }

  // ─── Purchase a DID ──────────────────────────────────────────────────────

  async purchaseDID(didId: string, params?: {
    forwardTo?: string;
    assignedTo?: string;
  }): Promise<DIDPurchaseResult> {
    switch (this.config.providerType) {
      case "didww": return this._purchaseDIDWW(didId, params);
      case "didx": return this._purchaseDIDDIDX(didId, params);
      case "custom": return this._purchaseDIDCustom(didId, params);
      default: return { success: false, error: "No DID provider configured" };
    }
  }

  // ─── Cancel/release a DID ────────────────────────────────────────────────

  async cancelDID(didId: string): Promise<boolean> {
    try {
      const baseUrl = this._getBaseUrl();
      const response = await fetch(`${baseUrl}/dids/${didId}`, {
        method: "DELETE",
        headers: this._headers(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─── Update DID forwarding ───────────────────────────────────────────────

  async updateForwarding(didId: string, forwardTo: string): Promise<boolean> {
    try {
      const baseUrl = this._getBaseUrl();
      const response = await fetch(`${baseUrl}/dids/${didId}`, {
        method: "PATCH",
        headers: this._headers(),
        body: JSON.stringify({ forward_to: forwardTo }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─── DIDww implementation ─────────────────────────────────────────────────

  private async _searchDIDWW(params: any): Promise<AvailableDID[]> {
    try {
      const url = new URL(`${DIDWW_BASE}/available_dids`);
      if (params.countryCode) url.searchParams.set("filter[country_iso]", params.countryCode);
      if (params.type) url.searchParams.set("filter[did_group.did_type]", params.type);
      url.searchParams.set("page[size]", String(params.limit ?? 50));

      const res = await fetch(url.toString(), { headers: this._headers() });
      const json = await res.json();

      return (json.data ?? []).map((d: any) => ({
        id: d.id,
        number: d.attributes?.number ?? "",
        countryCode: d.attributes?.country_iso ?? "",
        countryName: d.attributes?.country_name ?? "",
        city: d.attributes?.city_name ?? "",
        type: d.attributes?.did_type ?? "local",
        monthlyRate: parseFloat(d.attributes?.monthly_rate ?? "0"),
        setupFee: parseFloat(d.attributes?.setup_rate ?? "0"),
        currency: "USD",
        features: d.attributes?.features ?? ["voice"],
        available: true,
      }));
    } catch (e) {
      console.error("[DID] DIDww search failed:", e);
      return [];
    }
  }

  private async _getMyDIDsWW(): Promise<MyDID[]> {
    try {
      const res = await fetch(`${DIDWW_BASE}/dids?page[size]=100`, { headers: this._headers() });
      const json = await res.json();
      return (json.data ?? []).map((d: any) => ({
        id: d.id,
        number: d.attributes?.number ?? "",
        countryCode: d.attributes?.country_iso ?? "",
        countryName: d.attributes?.country_name ?? "",
        type: d.attributes?.did_type ?? "local",
        monthlyRate: parseFloat(d.attributes?.monthly_rate ?? "0"),
        currency: "USD",
        status: d.attributes?.status ?? "active",
        activatedAt: d.attributes?.created_at ?? "",
        renewsAt: d.attributes?.expires_at ?? "",
        features: d.attributes?.features ?? ["voice"],
      }));
    } catch (e) {
      console.error("[DID] DIDww getMyDIDs failed:", e);
      return [];
    }
  }

  private async _purchaseDIDWW(didId: string, params?: any): Promise<DIDPurchaseResult> {
    try {
      const res = await fetch(`${DIDWW_BASE}/orders`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          data: {
            type: "orders",
            attributes: { items: [{ did_id: didId }] },
          },
        }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      return { success: true, orderId: json.data?.id };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // ─── DIDx implementation ──────────────────────────────────────────────────

  private async _searchDIDX(params: any): Promise<AvailableDID[]> {
    try {
      const url = new URL(`${DIDX_BASE}/numbers/search`);
      if (params.countryCode) url.searchParams.set("country", params.countryCode);
      url.searchParams.set("limit", String(params.limit ?? 50));

      const res = await fetch(url.toString(), { headers: this._headers() });
      const json = await res.json();

      return (json.numbers ?? []).map((n: any) => ({
        id: n.number,
        number: n.number,
        countryCode: n.country ?? "",
        countryName: n.country_name ?? "",
        city: n.city ?? "",
        type: (n.type ?? "local") as DIDNumberType,
        monthlyRate: parseFloat(n.monthly_rate ?? "0"),
        setupFee: parseFloat(n.setup_fee ?? "0"),
        currency: "USD",
        features: ["voice", "sms"],
        available: true,
      }));
    } catch (e) {
      console.error("[DID] DIDx search failed:", e);
      return [];
    }
  }

  private async _getMyDIDsDIDX(): Promise<MyDID[]> {
    try {
      const res = await fetch(`${DIDX_BASE}/numbers/my`, { headers: this._headers() });
      const json = await res.json();
      return (json.numbers ?? []).map((n: any) => ({
        id: n.id ?? n.number,
        number: n.number,
        countryCode: n.country ?? "",
        countryName: n.country_name ?? "",
        type: (n.type ?? "local") as DIDNumberType,
        monthlyRate: parseFloat(n.monthly_rate ?? "0"),
        currency: "USD",
        status: n.status ?? "active",
        activatedAt: n.activated_at ?? "",
        renewsAt: n.renews_at ?? "",
        features: ["voice", "sms"],
      }));
    } catch (e) {
      console.error("[DID] DIDx getMyDIDs failed:", e);
      return [];
    }
  }

  private async _purchaseDIDDIDX(number: string, params?: any): Promise<DIDPurchaseResult> {
    try {
      const res = await fetch(`${DIDX_BASE}/numbers/purchase`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ number, forward_to: params?.forwardTo }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // ─── Custom provider implementation ──────────────────────────────────────

  private async _searchCustom(params: any): Promise<AvailableDID[]> {
    const baseUrl = this.config.apiUrl ?? "";
    if (!baseUrl) return [];
    try {
      const url = new URL(`${baseUrl}/available`);
      if (params.countryCode) url.searchParams.set("country", params.countryCode);
      const res = await fetch(url.toString(), { headers: this._headers() });
      const json = await res.json();
      return json.numbers ?? json.data ?? [];
    } catch {
      return [];
    }
  }

  private async _getMyDIDsCustom(): Promise<MyDID[]> {
    const baseUrl = this.config.apiUrl ?? "";
    if (!baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/my`, { headers: this._headers() });
      const json = await res.json();
      return json.numbers ?? json.data ?? [];
    } catch {
      return [];
    }
  }

  private async _purchaseDIDCustom(didId: string, params?: any): Promise<DIDPurchaseResult> {
    const baseUrl = this.config.apiUrl ?? "";
    if (!baseUrl) return { success: false, error: "No custom DID API URL configured" };
    try {
      const res = await fetch(`${baseUrl}/purchase`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ did_id: didId, ...params }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-API-Key": this.config.apiKey,
    };
  }

  private _getBaseUrl(): string {
    switch (this.config.providerType) {
      case "didww": return DIDWW_BASE;
      case "didx": return DIDX_BASE;
      case "custom": return this.config.apiUrl ?? "";
      default: return "";
    }
  }
}

export const didClient = new DIDClient();
