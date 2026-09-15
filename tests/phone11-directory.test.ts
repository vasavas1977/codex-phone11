import { describe, expect, it } from "vitest";
import {
  canCallDirectoryContact,
  filterDirectory,
  positiveRouteId,
  readDirectory,
} from "../lib/phone/directory";
import { PHONE_CAPABILITIES } from "../lib/phone/capabilities";

describe("directory data boundaries", () => {
  it("keeps only directory fields, with no fabricated presence or exposed SIP secret", () => {
    expect(
      readDirectory([
        {
          id: 5,
          name: "  สมชาย  ",
          extension: "3001",
          password: "private",
          presence: "busy",
        },
      ]),
    ).toEqual([{ id: 5, name: "สมชาย", extension: "3001" }]);
  });
  it("rejects ambiguous identity and malformed payloads", () => {
    for (const value of [
      null,
      {},
      [{ id: "5", name: "Jane", extension: "3001" }],
      [{ id: 5, name: "", extension: null }],
      [
        { id: 5, name: "Jane", extension: null },
        { id: 5, name: "John", extension: null },
      ],
    ]) {
      expect(() => readDirectory(value)).toThrow("Invalid directory response");
    }
  });
  it("supports Thai, case-insensitive names and formatted extensions", () => {
    const people = [
      { id: 5, name: "สมชาย ใจดี", extension: "3001" },
      { id: 6, name: "Jane Chen", extension: null },
    ];
    expect(filterDirectory(people, "สมชาย").map((p) => p.id)).toEqual([5]);
    expect(filterDirectory(people, "JANE").map((p) => p.id)).toEqual([6]);
    expect(filterDirectory(people, "3-001").map((p) => p.id)).toEqual([5]);
    expect(filterDirectory(people, "unknown")).toEqual([]);
  });
  it("does not silently choose a tenant for malformed route IDs", () => {
    expect(positiveRouteId("5")).toBe(5);
    for (const value of [
      undefined,
      ["5"],
      "1.2",
      "0",
      "-1",
      "5abc",
      "9007199254740992",
    ])
      expect(positiveRouteId(value)).toBeUndefined();
  });
  it("allows bare-extension calls only for the owning phone tenant", () => {
    const person = { id: 5, name: "Jane", extension: "3001" };
    const account = { ownerUserId: 1, tenantId: 7, enabled: true };
    expect(canCallDirectoryContact(person, 7, account, 1)).toBe(true);
    expect(canCallDirectoryContact(person, 8, account, 1)).toBe(false);
    expect(canCallDirectoryContact(person, 7, account, 2)).toBe(false);
    expect(
      canCallDirectoryContact(
        person,
        7,
        { ...account, tenantId: undefined },
        1,
      ),
    ).toBe(false);
    expect(
      canCallDirectoryContact(person, 7, { ...account, enabled: false }, 1),
    ).toBe(false);
    expect(
      canCallDirectoryContact({ ...person, extension: "*98" }, 7, account, 1),
    ).toBe(false);
  });
  it("does not advertise unsupported calling and SMS actions", () => {
    expect(PHONE_CAPABILITIES).toMatchObject({
      voice: true,
      video: false,
      transfer: false,
      conference: false,
      sms: false,
      backgroundIncoming: false,
    });
  });
});
