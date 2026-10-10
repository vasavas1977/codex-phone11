import { afterEach, describe, expect, it, vi } from "vitest";
import { scrubInvitationBrowserUrl } from "../lib/invitation-ui";

afterEach(() => vi.unstubAllGlobals());

describe("invitation fragment cleanup", () => {
  it("clears the address bar and route state without replacing the screen", () => {
    const location = new URL("https://phone11.test/auth/accept-invitation?source=email#token=secret-invite");
    const history = {
      state: { route: "accept-invitation" },
      replaceState: vi.fn((_state: unknown, _title: string, relativeUrl: string) => {
        location.href = new URL(relativeUrl, location.href).href;
      }),
    };
    vi.stubGlobal("window", { location, history });

    let routeFragment = "token=secret-invite";
    const setFocusedRouteParams = vi.fn(() => { routeFragment = ""; });
    scrubInvitationBrowserUrl(setFocusedRouteParams);

    expect(setFocusedRouteParams).toHaveBeenCalledOnce();
    expect(history.replaceState).toHaveBeenCalledWith(history.state, "", "/auth/accept-invitation?source=email");
    expect(location.hash).toBe("");
    expect(location.search).toBe("?source=email");

    // Expo Router's later URL write comes from its focused route params.
    location.hash = routeFragment;
    expect(location.href).not.toContain("secret-invite");
  });

  it("removes legacy query tokens and leaves a clean reload without a token", () => {
    const location = new URL("https://phone11.test/auth/accept-invitation?token=legacy-secret#token=secret-invite");
    const history = {
      state: {},
      replaceState: vi.fn((_state: unknown, _title: string, relativeUrl: string) => {
        location.href = new URL(relativeUrl, location.href).href;
      }),
    };
    vi.stubGlobal("window", { location, history });

    scrubInvitationBrowserUrl(() => {});
    expect(location.search).toBe("");
    expect(location.hash).toBe("");
    expect(location.href).not.toContain("secret");
  });
});
