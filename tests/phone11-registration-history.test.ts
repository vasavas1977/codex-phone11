import { describe, expect, it } from "vitest";
import { lastRegistrationLabel } from "../lib/pbx/registration-history";

describe("PBX registration history", () => {
  it("displays a historical event rather than claiming that the phone is connected", () => {
    const label = lastRegistrationLabel("2020-01-02T12:00:00Z");
    expect(label).toContain("Jan");
    expect(label).toContain("2020");
    expect(label).not.toMatch(/registered|connected|online/i);
  });

  it.each([undefined, null, "", "invalid timestamp"])(
    "keeps an absent or invalid event unknown: %s",
    (value) => expect(lastRegistrationLabel(value)).toBe("Not reported"),
  );
});
