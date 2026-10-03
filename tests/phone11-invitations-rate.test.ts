import { describe, expect, it } from "vitest";
import { boundedInvitationAcceptance, limitInvitationOperation } from "../server/invitations/rate-limit";

describe("Phone11 invitation operation bounds", () => {
  it("bounds public token inspection by client address", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    for (let n = 0; n < 30; n++) expect(() => limitInvitationOperation("inspect", key)).not.toThrow();
    expect(() => limitInvitationOperation("inspect", key)).toThrowError(/Too many invitation requests/);
    expect(() => limitInvitationOperation("inspect", `${key}-other`)).not.toThrow();
  });

  it("bounds simultaneous password hashing work", async () => {
    const releases: (() => void)[] = [];
    const active = Array.from({ length: 8 }, () => boundedInvitationAcceptance(
      () => new Promise<void>(resolve => releases.push(resolve)),
    ));
    await expect(boundedInvitationAcceptance(async () => undefined)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    releases.forEach(release => release());
    await Promise.all(active);
    await expect(boundedInvitationAcceptance(async () => "open")).resolves.toBe("open");
  });
});
