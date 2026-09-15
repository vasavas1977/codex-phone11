import { describe, it, expect, vi } from "vitest";
import {
  createDeviceContactsStore,
  readDeviceContacts,
  deviceContactName,
  filterDeviceContacts,
  type ContactPermission,
} from "../lib/phone/device-contacts";
const rows = [
  {
    id: "1",
    name: "Alice",
    phoneNumbers: [
      { number: "0825826667", label: "Mobile" },
      { number: "+66825826667" },
      { number: "3001" },
    ],
  },
];
describe("device contacts, read only and memory only", () => {
  it("deduplicates local and international numbers, omits invalid extensions, and matches caller country-code variants", () => {
    const people = readDeviceContacts(rows);
    expect(people[0].phones).toHaveLength(1);
    expect(deviceContactName(people, "66825826667")).toBe("Alice");
    expect(filterDeviceContacts(people, "+66 82582")).toEqual(people);
    expect(filterDeviceContacts(people, "ALIce")).toEqual(people);
    expect(
      deviceContactName(
        [...people, { ...people[0], id: "2", name: "Bob" }],
        "+66825826667",
      ),
    ).toBeUndefined();
  });
  it("does not read or prompt until permission is granted, and clears revoked contacts", async () => {
    let permission: ContactPermission = "unknown";
    const request = vi.fn(async () => permission);
    const read = vi.fn(async () => rows);
    const store = createDeviceContactsStore({ permission: request, read });
    await store.refresh();
    expect(request).toHaveBeenCalledWith(false);
    expect(read).not.toHaveBeenCalled();
    permission = "granted";
    await store.refresh(true);
    expect(store.getSnapshot().people).toHaveLength(1);
    permission = "denied";
    await store.refresh();
    expect(store.getSnapshot().people).toEqual([]);
  });
  it("replaces the snapshot when a contact is edited or deleted", async () => {
    let current = rows;
    const store = createDeviceContactsStore({
      permission: async () => "limited",
      read: async () => current,
    });
    await store.refresh();
    expect(store.getSnapshot().permission).toBe("limited");
    current = [{ ...rows[0], name: "New name" }];
    await store.refresh();
    expect(store.getSnapshot().people[0].name).toBe("New name");
    current = [];
    await store.refresh();
    expect(store.getSnapshot().people).toEqual([]);
  });
  it("discards a read if permission changes while loading", async () => {
    let permission: ContactPermission = "granted";
    const store = createDeviceContactsStore({
      permission: async () => permission,
      read: async () => {
        permission = "denied";
        return rows;
      },
    });
    await store.refresh();
    expect(store.getSnapshot().people).toEqual([]);
    expect(store.getSnapshot().permission).toBe("denied");
  });
  it("a late read cannot repopulate the cleared snapshot on background/unmount", async () => {
    let finish!: (value: typeof rows) => void;
    const store = createDeviceContactsStore({
      permission: async () => "granted",
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = store.refresh();
    await Promise.resolve();
    store.clear();
    finish(rows);
    await pending;
    expect(store.getSnapshot().people).toEqual([]);
  });
  it("new refresh wins over an older delayed read and errors reveal no contact data", async () => {
    let finish!: (value: typeof rows) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("private contact details"));
    const store = createDeviceContactsStore({
      permission: async () => "granted",
      read,
    });
    const old = store.refresh();
    await Promise.resolve();
    await store.refresh();
    finish(rows);
    await old;
    expect(store.getSnapshot().people).toEqual([]);
    await store.refresh();
    expect(store.getSnapshot().error).not.toContain("private");
  });
});
