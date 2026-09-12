import { contactPhoneKey } from "./phone-number";

export interface DeviceContact {
  id: string;
  name: string;
  phones: { number: string; label: string; key: string }[];
}
export interface RawDeviceContact {
  id?: string;
  name?: string;
  phoneNumbers?: { number?: string; label?: string }[];
}
export function readDeviceContacts(rows: RawDeviceContact[]): DeviceContact[] {
  const ids = new Set<string>();
  return rows
    .flatMap((row) => {
      if (!row.id || ids.has(row.id)) return [];
      ids.add(row.id);
      const keys = new Set<string>();
      const phones = (row.phoneNumbers ?? []).flatMap((phone) => {
        const number = phone.number?.trim();
        const key = number ? contactPhoneKey(number) : null;
        if (!number || !key || keys.has(key)) return [];
        keys.add(key);
        return [{ number, label: phone.label || "Phone", key }];
      });
      if (!phones.length) return [];
      return [
        { id: row.id, name: row.name?.trim() || phones[0].number, phones },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, ["th", "en"]));
}
export function filterDeviceContacts(rows: DeviceContact[], query: string) {
  const text = query.normalize("NFKC").trim().toLocaleLowerCase();
  const digits = text.replace(/\D/g, "");
  return rows.filter(
    (row) =>
      !text ||
      row.name.normalize("NFKC").toLocaleLowerCase().includes(text) ||
      (digits &&
        row.phones.some(
          (p) =>
            p.number.replace(/\D/g, "").includes(digits) ||
            p.key.includes(digits),
        )),
  );
}
/** Ambiguous shared numbers intentionally keep their number instead of guessing a person. */
export function deviceContactName(
  rows: DeviceContact[],
  number: string,
): string | undefined {
  const key = contactPhoneKey(number);
  if (!key) return undefined;
  const matches = rows.filter((row) =>
    row.phones.some((phone) => phone.key === key),
  );
  return matches.length === 1 ? matches[0].name : undefined;
}
export type ContactPermission =
  | "unknown"
  | "granted"
  | "limited"
  | "denied"
  | "unsupported";
export interface DeviceContactState {
  permission: ContactPermission;
  people: DeviceContact[];
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
}
export interface DeviceContactsAdapter {
  permission(request: boolean): Promise<ContactPermission>;
  read(): Promise<RawDeviceContact[]>;
}
/** Memory only; no address-book data is persisted, logged, or sent to the server. */
export function createDeviceContactsStore(adapter: DeviceContactsAdapter) {
  let state: DeviceContactState = {
    permission: "unknown",
    people: [],
    loading: false,
    error: null,
    refreshedAt: null,
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: DeviceContactState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    clear() {
      generation++;
      publish({ ...state, people: [], loading: false, refreshedAt: null });
    },
    async refresh(request = false) {
      const current = ++generation;
      publish({ ...state, people: [], loading: true, error: null });
      try {
        const permission = await adapter.permission(request);
        if (current !== generation) return;
        if (permission !== "granted" && permission !== "limited") {
          publish({
            permission,
            people: [],
            loading: false,
            error: null,
            refreshedAt: null,
          });
          return;
        }
        const rows = await adapter.read();
        // Permission may be revoked or the limited selection reduced during a read.
        const after = await adapter.permission(false);
        if (current !== generation) return;
        if (after !== permission) {
          publish({
            permission: after,
            people: [],
            loading: false,
            error: null,
            refreshedAt: null,
          });
          return;
        }
        publish({
          permission,
          people: readDeviceContacts(rows),
          loading: false,
          error: null,
          refreshedAt: Date.now(),
        });
      } catch {
        if (current === generation)
          publish({
            ...state,
            people: [],
            loading: false,
            error: "Could not refresh contacts. Please try again.",
            refreshedAt: null,
          });
      }
    },
  };
}
