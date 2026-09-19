import type { ChatMessage } from "./types";
export interface PendingChat {
  drafts: Record<string, string>;
  messages: Record<string, ChatMessage[]>;
}
export interface ChatPersistence {
  load(userId: number, tenantId: number): Promise<PendingChat>;
  save(userId: number, tenantId: number, value: PendingChat): Promise<void>;
  clearOwner(userId: number): Promise<void>;
}
export interface PendingStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
const prefix = "phone11.chat.pending.v1:";
const ownerPrefix = (id: number) => `${prefix}user:${id}:tenant:`;
const storageKey = (id: number, tenantId: number) =>
  `${ownerPrefix(id)}${tenantId}`;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Store only drafts and unacknowledged text, never a copy of server message history. */
export function decodePending(raw: string | null, owner: number): PendingChat {
  const result: PendingChat = { drafts: {}, messages: {} };
  if (!raw) return result;
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !data.drafts || !data.messages) return result;
    for (const [id, value] of Object.entries(data.drafts))
      if (
        id.split(":thread:").length <= 2 &&
        id.split(":thread:").every((part) => uuid.test(part)) &&
        typeof value === "string" &&
        value.length <= 4000
      )
        result.drafts[id] = value;
    for (const [id, rows] of Object.entries(data.messages)) {
      if (!uuid.test(id) || !Array.isArray(rows)) continue;
      result.messages[id] = rows
        .filter(
          (m) =>
            m &&
            m.channelId === id &&
            m.senderId === owner &&
            uuid.test(m.id) &&
            uuid.test(m.clientId) &&
            typeof m.content === "string" &&
            (m.content.trim() ||
              (Array.isArray(m.attachments) && m.attachments.length > 0)) &&
            m.content.length <= 4000 &&
            Number.isFinite(m.timestamp) &&
            (m.status === "sending" || m.status === "failed"),
        )
        .map((m) => {
          const parent =
            m.parent &&
            uuid.test(m.parent.id) &&
            typeof m.parent.senderName === "string" &&
            m.parent.senderName.length <= 200 &&
            typeof m.parent.content === "string" &&
            m.parent.content.length <= 4000
              ? {
                  id: m.parent.id,
                  senderName: m.parent.senderName,
                  content: m.parent.content,
                }
              : null;
          return {
            id: m.id,
            channelId: id,
            clientId: m.clientId,
            senderId: owner,
            senderName: "You",
            content: m.content,
            timestamp: m.timestamp,
            sequence: 0,
            status: "failed" as const,
            parent,
            attachments: Array.isArray(m.attachments)
              ? m.attachments
                  .filter(
                    (a: any) =>
                      a &&
                      uuid.test(a.id) &&
                      typeof a.filename === "string" &&
                      a.filename.length <= 255 &&
                      typeof a.mimeType === "string" &&
                      a.mimeType.length < 100 &&
                      Number.isSafeInteger(a.sizeBytes) &&
                      a.sizeBytes > 0 &&
                      a.sizeBytes <= 10485760,
                  )
                  .slice(0, 10)
                  .map((a: any) => ({
                    id: a.id,
                    conversationId: id,
                    status: "ready" as const,
                    filename: a.filename,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                  }))
              : [],
            // Pending ranges preserve a selected member identity across an
            // offline retry. Names are intentionally re-resolved by server.
            mentions: Array.isArray(m.mentions)
              ? m.mentions.filter((mention: any) => mention && Number.isSafeInteger(mention.userId) && mention.userId > 0
                && Number.isSafeInteger(mention.start) && mention.start >= 0 && Number.isSafeInteger(mention.length) && mention.length >= 2
                && mention.start + mention.length <= m.content.length).slice(0, 20)
                .map((mention: any) => ({ userId: mention.userId, start: mention.start, length: mention.length, name: "Team member" }))
              : [],
          };
        })
        .filter((m) => m.content.trim() || m.attachments.length > 0);
    }
  } catch {
    /* A damaged cache cannot become a message or an authority source. */
  }
  return result;
}

export function createChatPersistence(
  storage: PendingStorage,
): ChatPersistence {
  // One queue orders writes, reads, and logout deletion. A late old write cannot
  // re-create data after clearOwner has completed.
  let queue: Promise<unknown> = Promise.resolve();
  const ordered = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.catch(() => {}).then(operation);
    queue = result;
    return result;
  };
  return {
    load: (owner, tenant) =>
      ordered(async () =>
        decodePending(await storage.getItem(storageKey(owner, tenant)), owner),
      ),
    save: (owner, tenant, value) =>
      ordered(() =>
        storage.setItem(
          storageKey(owner, tenant),
          JSON.stringify({ version: 1, ...value }),
        ),
      ),
    clearOwner: (owner) =>
      ordered(async () => {
        const keys = (await storage.getAllKeys()).filter((key) =>
          key.startsWith(ownerPrefix(owner)),
        );
        for (const key of keys) await storage.removeItem(key);
      }),
  };
}
