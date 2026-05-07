import { DEFAULT_ACCOUNT, type SipAccount, type SipTransport } from "./account-store";

export interface PhoneProvisioningConfig {
  configured: boolean;
  extension?: {
    number: string;
    displayName: string;
    callerIdName?: string | null;
    callerIdNumber?: string | null;
  };
  sip?: {
    username: string;
    password: string;
    domain: string;
    port?: number | null;
    transport?: string | null;
    proxy?: string | null;
    srtp?: boolean | null;
    stun?: string | null;
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

export function normalizeSipTransport(value?: string | null): SipTransport {
  const normalized = value?.toUpperCase();
  if (normalized === "UDP" || normalized === "TCP" || normalized === "TLS") {
    return normalized;
  }
  return DEFAULT_ACCOUNT.transport;
}

export function defaultSipPort(transport: SipTransport, port?: number | null): number {
  if (Number.isFinite(port) && port && port > 0) {
    if (transport === "TLS" && port === 5060) return 5061;
    return port;
  }
  return transport === "TLS" ? 5061 : 5060;
}

export function sipAccountFromPhoneConfig(
  config: PhoneProvisioningConfig,
  existingId = DEFAULT_ACCOUNT.id,
): SipAccount {
  if (!config.configured || !config.sip) {
    throw new Error("No SIP account is assigned to this user.");
  }

  const transport = normalizeSipTransport(config.sip.transport);

  return {
    id: existingId,
    displayName: config.extension?.displayName || config.sip.username,
    username: config.sip.username,
    password: config.sip.password,
    domain: config.sip.domain,
    proxy: config.sip.proxy || "",
    port: defaultSipPort(transport, config.sip.port),
    transport,
    srtp: config.sip.srtp ?? DEFAULT_ACCOUNT.srtp,
    stun: config.sip.stun ?? DEFAULT_ACCOUNT.stun,
    enabled: true,
  };
}
