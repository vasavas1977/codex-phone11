import { describe, expect, it } from "vitest";
import { contactPhoneKey, internationalHistoryNumber } from "../lib/phone/phone-number";

describe("international history numbers", () => {
  it.each([
    ["66825826667", "+66825826667"],
    ["66966954922", "+66966954922"],
    ["6620303001", "+6620303001"],
    ["12025550123", "+12025550123"],
    ["442079460018", "+442079460018"],
    ["+66825826667", "+66825826667"],
    ["66 82-582-6667", "+66825826667"],
  ])("formats %s as %s", (value, expected) => {
    expect(internationalHistoryNumber(value)).toBe(expected);
  });
  it.each(["3001", "6667", "1669", "*123#", "0825826667", "02-030-3001", "Unknown", "anonymous", "Call 66825826667", "999123456789", "66825826667;ext=3001", "66825826667,3001", "1234567890123456"])("preserves non-international input %s", value => {
    expect(internationalHistoryNumber(value)).toBe(value);
  });
});

describe("local address-book matching", () => {
  it("matches Thai local and country-code forms without changing a stored contact", () => {
    for (const value of ["082-582-6667", "66825826667", "+66 82 582 6667"])
      expect(contactPhoneKey(value)).toBe("+66825826667");
    expect(contactPhoneKey("02 030 3001")).toBe("+6620303001");
  });
  it("does not treat extensions, service codes or prose as contact phone numbers", () => {
    for (const value of ["3001", "*123#", "1669", "Unknown", "Call 0825826667", "12345678"])
      expect(contactPhoneKey(value)).toBeNull();
  });
});
