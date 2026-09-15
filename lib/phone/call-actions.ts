import type { DeviceContact } from "./device-contacts";
import { contactPhoneKey } from "./phone-number";
import type { ChatChannel, ChatPerson } from "../chat/types";

export interface DirectChatTarget {
  personId: number;
  conversationId: string;
  workspaceId: number;
}

/** Ambiguous address-book matches never open an arbitrary person's profile. */
export function uniqueDeviceContactId(
  contacts: DeviceContact[],
  number: string,
): string | undefined {
  const key = contactPhoneKey(number);
  if (!key) return undefined;
  const matches = contacts.filter((contact) =>
    contact.phones.some((phone) => phone.key === key),
  );
  return matches.length === 1 ? matches[0].id : undefined;
}

/**
 * Resolve Chat only when the number is one unique teammate's exact extension
 * and an existing one-to-one conversation already contains both members.
 */
export function resolveExistingDirectChat({
  number,
  ownerUserId,
  workspaceId,
  people,
  channels,
}: {
  number: string;
  ownerUserId: number;
  workspaceId: number;
  people: ChatPerson[];
  channels: ChatChannel[];
}): DirectChatTarget | undefined {
  const extension = number.trim();
  if (!/^\d{1,8}$/.test(extension)) return undefined;
  const matches = people.filter(
    (person) => person.id !== ownerUserId && person.extension === extension,
  );
  if (matches.length !== 1) return undefined;
  const person = matches[0];
  const conversations = channels.filter(
    (channel) =>
      channel.kind === "direct" &&
      channel.memberIds.length === 2 &&
      channel.memberIds.includes(ownerUserId) &&
      channel.memberIds.includes(person.id),
  );
  if (conversations.length !== 1) return undefined;
  return {
    personId: person.id,
    conversationId: conversations[0].id,
    workspaceId,
  };
}

export interface FavoriteStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface CallFavoritesSnapshot {
  ownerUserId: number | null;
  ids: readonly string[];
  loading: boolean;
  error: string | null;
}

const MAX_FAVORITES = 500;
const favoriteKey = (owner: number) =>
  `phone11_call_favorites_v1_user_${owner}`;

function decodeFavorites(raw: string | null): string[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Invalid call favorites");
  return [
    ...new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && id.length > 0 && id.length <= 256,
      ),
    ),
  ].slice(0, MAX_FAVORITES);
}

export function createCallFavoritesStore(
  storage: FavoriteStorage,
  currentOwner: () => number | null,
) {
  let snapshot: CallFavoritesSnapshot = {
    ownerUserId: null,
    ids: [],
    loading: false,
    error: null,
  };
  let revision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: CallFavoritesSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const serialize = <T,>(operation: () => Promise<T>) => {
    const task = queue.then(operation, operation);
    queue = task.catch(() => undefined);
    return task;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      revision++;
      publish({ ownerUserId: null, ids: [], loading: false, error: null });
    },
    async load(ownerUserId: number | null) {
      const current = ++revision;
      if (!ownerUserId || currentOwner() !== ownerUserId) {
        publish({ ownerUserId: null, ids: [], loading: false, error: null });
        return;
      }
      publish({ ownerUserId, ids: [], loading: true, error: null });
      try {
        await serialize(async () => {
          const ids = decodeFavorites(
            await storage.getItem(favoriteKey(ownerUserId)),
          );
          if (current !== revision || currentOwner() !== ownerUserId) return;
          publish({ ownerUserId, ids, loading: false, error: null });
        });
      } catch {
        if (current === revision && currentOwner() === ownerUserId)
          publish({
            ownerUserId,
            ids: [],
            loading: false,
            error: "Could not load starred calls. Pull to retry.",
          });
      }
    },
    async toggle(ownerUserId: number, callId: string): Promise<boolean> {
      if (
        !Number.isSafeInteger(ownerUserId) ||
        ownerUserId <= 0 ||
        !callId ||
        callId.length > 256
      )
        throw new Error("Invalid call favorite");
      return serialize(async () => {
        if (currentOwner() !== ownerUserId)
          throw new Error("Call favorite owner changed");
        const ids = decodeFavorites(
          await storage.getItem(favoriteKey(ownerUserId)),
        );
        if (currentOwner() !== ownerUserId)
          throw new Error("Call favorite owner changed");
        const starred = !ids.includes(callId);
        const next = starred
          ? [callId, ...ids].slice(0, MAX_FAVORITES)
          : ids.filter((id) => id !== callId);
        await storage.setItem(favoriteKey(ownerUserId), JSON.stringify(next));
        if (currentOwner() === ownerUserId) {
          revision++;
          publish({
            ownerUserId,
            ids: next,
            loading: false,
            error: null,
          });
        }
        return starred;
      });
    },
  };
}
