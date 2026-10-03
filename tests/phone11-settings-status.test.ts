import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock("@/components/screen-container", () => ({
  ScreenContainer: () => null,
}));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({}) }));
vi.mock("@/lib/sip/account-store", () => ({ useSipAccountStore: () => null }));
vi.mock("@/lib/sip/sip-provider", () => ({
  useSip: () => ({ reconnectPhone: vi.fn() }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));
vi.mock("@/lib/notifications/client", () => ({
  chatNotificationClientEnabled: () => false,
}));
vi.mock("@/lib/theme-provider", () => ({ useThemeContext: () => ({}) }));
vi.mock("@/lib/trpc", () => ({
  trpc: { pbx: { tenant: { get: { useQuery: () => ({}) } } } },
}));

import {
  enabledPhoneAccountForUser,
  PHONE11_PREVIEW_AVAILABILITY_COPY,
  phoneConnectionStatus,
} from "../app/(tabs)/settings";

it.each([
  ["registered", "Ready to call", "success"],
  ["registering", "Connecting…", "warning"],
  ["failed", "Connection failed", "error"],
  ["network_error", "Offline", "error"],
  ["unregistered", "Connecting…", "muted"],
] as const)(
  "uses the Phone tab status for %s SIP state",
  (state, label, tone) => {
    expect(phoneConnectionStatus(true, true, state)).toEqual({ label, tone });
  },
);

it("shows sign-in and extension setup independently of stale SIP state", () => {
  expect(phoneConnectionStatus(false, false, "failed").label).toBe(
    "Sign in to connect",
  );
  expect(phoneConnectionStatus(true, false, "network_error").label).toBe(
    "Extension setup required",
  );
});

it("treats a disabled saved account as setup required and unavailable for reconnect", () => {
  const savedAccount = {
    ownerUserId: 17,
    enabled: false,
    id: "test-account",
    displayName: "Work phone",
    username: "1001",
    password: "test-only",
    domain: "sip.example.test",
    port: 5061,
    transport: "TLS" as const,
    srtp: true,
  };
  const account = enabledPhoneAccountForUser(savedAccount, 17);

  expect(account).toBeNull();
  expect(phoneConnectionStatus(true, Boolean(account), "registered")).toEqual({
    label: "Extension setup required",
    tone: "warning",
  });
});

it("keeps trial and background-call limits while describing gated Team Chat meetings", () => {
  expect(PHONE11_PREVIEW_AVAILABILITY_COPY.meetings).toContain("60 seconds");
  expect(PHONE11_PREVIEW_AVAILABILITY_COPY.meetings).toContain(
    "Team Chat video meetings are available when enabled",
  );
  expect(PHONE11_PREVIEW_AVAILABILITY_COPY.other).toContain(
    "Call transfer, PBX conference calling and SMS are not available",
  );
  expect(PHONE11_PREVIEW_AVAILABILITY_COPY.foreground).toContain(
    "not available in this preview",
  );
  expect(
    Object.values(PHONE11_PREVIEW_AVAILABILITY_COPY).join(" "),
  ).not.toContain(
    "Video, transfer, conference calling and SMS are not available yet",
  );
});
