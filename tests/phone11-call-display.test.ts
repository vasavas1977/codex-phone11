import { expect, it } from "vitest";
import {
  callDisplayIdentity,
  callDisplayNumber,
} from "../lib/phone/call-display";
const contacts = [
  {
    id: "1",
    name: "Ping Ping Daughter",
    phones: [{ number: "+66625503222", key: "+66625503222", label: "Mobile" }],
  },
];
it.each([
  ["sip:+66625503222@sip.phone11.ai", "+66625503222"],
  [
    '"Someone" <sips:%2B66625503222@sip.phone11.ai;transport=tls>',
    "+66625503222",
  ],
  ["sip:3002@example.com", "3002"],
  ["tel:+66625503222;ext=12", "+66625503222"],
  [undefined, "Unknown caller"],
])("cleans display identity %s without exposing routing", (input, expected) =>
  expect(callDisplayNumber(input)).toBe(expected),
);
it("prefers a unique local contact over raw SIP display names", () => {
  expect(
    callDisplayIdentity(
      "sip:+66625503222@sip.phone11.ai",
      "sip:+66625503222@sip.phone11.ai",
      contacts,
    ).title,
  ).toBe("Ping Ping Daughter");
});
it("keeps friendly team names and avoids guessing ambiguous address-book matches", () => {
  expect(callDisplayIdentity("sip:3002@example.com", "Alice", []).title).toBe(
    "Alice",
  );
  expect(
    callDisplayIdentity("sip:+66625503222@sip.phone11.ai", undefined, [
      ...contacts,
      { ...contacts[0], id: "2", name: "Other" },
    ]).title,
  ).toBe("+66625503222");
});
