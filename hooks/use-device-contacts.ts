import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import * as Contacts from "expo-contacts";
import {
  createDeviceContactsStore,
  type ContactPermission,
  type RawDeviceContact,
} from "@/lib/phone/device-contacts";

const store = createDeviceContactsStore({
  async permission(request): Promise<ContactPermission> {
    if (Platform.OS === "web") return "unsupported";
    const permission = request
      ? await Contacts.requestPermissionsAsync()
      : await Contacts.getPermissionsAsync();
    if (permission.accessPrivileges === "limited") return "limited";
    if (permission.granted) return "granted";
    return permission.status === "undetermined" ? "unknown" : "denied";
  },
  async read() {
    const rows: RawDeviceContact[] = [];
    let pageOffset = 0;
    for (;;) {
      const page = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        pageSize: 500,
        pageOffset,
      });
      rows.push(...page.data);
      if (!page.hasNextPage) return rows;
      if (!page.data.length) throw new Error("Contacts page did not advance");
      pageOffset += page.data.length;
    }
  },
});
let consumers = 0;
let appSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
const refreshWhenActive = (request = false) => {
  if (AppState.currentState !== "active") {
    store.clear();
    return Promise.resolve();
  }
  return store.refresh(request);
};
export function useDeviceContacts() {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    if (consumers++ === 0) {
      void refreshWhenActive();
      appSubscription = AppState.addEventListener("change", (next) => {
        if (next === "active") void store.refresh();
        else store.clear();
      });
    }
    return () => {
      if (--consumers === 0) {
        appSubscription?.remove();
        appSubscription = undefined;
        store.clear();
      }
    };
  }, []);
  return { ...state, refresh: refreshWhenActive };
}
