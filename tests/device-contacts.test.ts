import { describe, it, expect, vi } from "vitest";
import {
  createDeviceContactsStore,
  readDeviceContacts,
  deviceContactName,
  filterDeviceContacts,
  deviceContactImageUri,
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
  it("keeps only local native thumbnail URIs beside each contact", () => {
    const people = readDeviceContacts([
      { ...rows[0], image: { uri: "/var/mobile/Containers/Data/photo.png" } },
      { ...rows[0], id: "2", image: { uri: "content://com.android.contacts/photo/2" } },
      { ...rows[0], id: "3", image: { uri: "https://remote.example/photo.png" } },
    ]);
    expect(people.find((person) => person.id === "1")?.imageUri)
      .toBe("file:///var/mobile/Containers/Data/photo.png");
    expect(people.find((person) => person.id === "2")?.imageUri)
      .toBe("content://com.android.contacts/photo/2");
    expect(people.find((person) => person.id === "3")?.imageUri).toBeUndefined();
    expect(deviceContactImageUri("https://remote.example/photo.png")).toBeUndefined();
    expect(deviceContactImageUri("file://remote-host/photo.png")).toBeUndefined();
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
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
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
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const newer = store.refresh();
    finish(rows);
    await Promise.all([old, newer]);
    expect(store.getSnapshot().people).toEqual([]);
    await store.refresh();
    expect(store.getSnapshot().error).not.toContain("private");
  });
  it("cleans native thumbnails after an in-flight read before the next read", async () => {
    const events: string[] = [];
    let finish!: (value: typeof rows) => void;
    const clearCache = vi.fn(async () => { events.push("clear"); });
    const read = vi.fn()
      .mockImplementationOnce(() => {
        events.push("old read");
        return new Promise((resolve) => { finish = resolve; });
      })
      .mockImplementationOnce(async () => { events.push("new read"); return rows; });
    const store = createDeviceContactsStore({ permission: async () => "granted", read, clearCache });
    const old = store.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    store.clear();
    const newer = store.refresh();
    finish(rows);
    await Promise.all([old, newer]);
    expect(events).toEqual(["clear", "old read", "clear", "clear", "new read"]);
    expect(store.getSnapshot().people).toHaveLength(1);
  });
  it("cleans native thumbnails after permission revocation", async () => {
    let permission: ContactPermission = "granted";
    const clearCache = vi.fn(async () => {});
    const store = createDeviceContactsStore({
      permission: async () => permission,
      read: async () => rows,
      clearCache,
    });
    await store.refresh();
    permission = "denied";
    await store.refresh();
    await vi.waitFor(() => expect(clearCache).toHaveBeenCalledTimes(2));
    expect(store.getSnapshot().people).toEqual([]);
  });
});
