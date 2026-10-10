import { contactPhoneKey } from "./phone-number";

export interface DeviceContact {
  id: string;
  name: string;
  imageUri?: string;
  phones: { number: string; label: string; key: string }[];
}
export interface RawDeviceContact {
  id?: string;
  name?: string;
  image?: { uri?: string };
  phoneNumbers?: { number?: string; label?: string }[];
}
/** Native contact thumbnails stay on this device; reject network image sources. */
export function deviceContactImageUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith("/") && !uri.startsWith("//")) return `file://${uri}`;
  if (/^file:\/\/\/[^\s/][^\s]*$/i.test(uri) || /^content:\/\/[^/\s]+\/[^\s]+$/i.test(uri)) return uri;
  return undefined;
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
      const imageUri = deviceContactImageUri(row.image?.uri);
      return [{
        id: row.id,
        name: row.name?.trim() || phones[0].number,
        ...(imageUri ? { imageUri } : {}),
        phones,
      }];
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
  /** Remove only Expo Contacts' temporary thumbnail directory, when supported. */
  clearCache?(): Promise<void>;
}
/** App state is memory only; native thumbnail reads and targeted cleanup are serialized. */
export function createDeviceContactsStore(adapter: DeviceContactsAdapter) {
  let state: DeviceContactState = {
    permission: "unknown",
    people: [],
    loading: false,
    error: null,
    refreshedAt: null,
  };
  let generation = 0;
  let nativeWork: Promise<void> = Promise.resolve();
  const queueNative = <T,>(work: () => Promise<T>): Promise<T> => {
    const result = nativeWork.then(work, work);
    nativeWork = result.then(() => undefined, () => undefined);
    return result;
  };
  const clearCache = () => {
    if (adapter.clearCache)
      void queueNative(adapter.clearCache).catch(() => { /* The OS owns this temporary cache. */ });
  };
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
      clearCache();
    },
    async refresh(request = false) {
      const current = ++generation;
      publish({ ...state, people: [], loading: true, error: null });
      try {
        const permission = await adapter.permission(request);
        if (current !== generation) return;
        if (permission !== "granted" && permission !== "limited") {
          clearCache();
          publish({
            permission,
            people: [],
            loading: false,
            error: null,
            refreshedAt: null,
          });
          return;
        }
        const rows = await queueNative(async () => {
          // Remove thumbnails for contacts deleted since the previous read.
          await adapter.clearCache?.();
          return adapter.read();
        });
        // Permission may be revoked or the limited selection reduced during a read.
        const after = await adapter.permission(false);
        if (current !== generation) return;
        if (after !== permission) {
          clearCache();
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
        if (current === generation) {
          clearCache();
          publish({
            ...state,
            people: [],
            loading: false,
            error: "Could not refresh contacts. Please try again.",
            refreshedAt: null,
          });
        }
      }
    },
  };
}
