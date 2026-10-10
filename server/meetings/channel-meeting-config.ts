const enabledEnvironment = "PHONE11_CHANNEL_MEETINGS_ENABLED";
const tenantEnvironment = "PHONE11_CHANNEL_MEETING_TENANT_IDS";

export type ChannelMeetingConfiguration = {
  enabled: boolean;
  tenantIds: readonly number[];
};

/** Explicit opt-in only. Missing, malformed, empty, or duplicate tenant lists fail closed. */
export function readChannelMeetingConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChannelMeetingConfiguration {
  if (env[enabledEnvironment] !== "1") return { enabled: false, tenantIds: [] };
  const raw = env[tenantEnvironment];
  if (!raw) return { enabled: false, tenantIds: [] };
  const tenantIds = raw.split(",").map((value) => Number(value.trim()));
  if (
    !tenantIds.length ||
    tenantIds.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    new Set(tenantIds).size !== tenantIds.length
  ) return { enabled: false, tenantIds: [] };
  return { enabled: true, tenantIds };
}
