import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MENTION_TEXT, allMentionMatches, insertAllMention, isExactAllMention, reconcileAllMention } from "../lib/chat/all-mentions";

describe("chat @all contract", () => {
  it("matches only the canonical picker prefix", () => {
    expect(["", "a", "al", "all"].map(allMentionMatches)).toEqual([true, true, true, true]);
    expect(allMentionMatches("alice")).toBe(false);
    expect(allMentionMatches(" all")).toBe(false);
    expect(allMentionMatches("ทุกคน")).toBe(false);
  });

  it("validates the exact UTF-16 content range without a fake user id", () => {
    expect(isExactAllMention(`แจ้ง ${ALL_MENTION_TEXT} วันนี้`, { start: 5, length: 4 })).toBe(true);
    expect(isExactAllMention("@All", { start: 0, length: 4 })).toBe(false);
    expect(isExactAllMention("@all", { start: 1, length: 4 })).toBe(false);
  });

  it("inserts at the active caret and tracks edits without a user id", () => {
    const inserted = insertAllMention("Hi @al later", { start: 3, end: 6, query: "al" });
    expect(inserted).toEqual({ value: "Hi @all later", allMention: { start: 3, length: 4 }, selection: { start: 7, end: 7 } });
    expect(reconcileAllMention(inserted.value, `Before ${inserted.value}`, inserted.allMention)).toEqual({ start: 10, length: 4 });
    expect(reconcileAllMention(inserted.value, "Hi all later", inserted.allMention)).toBeUndefined();
  });

  it("defines one bounded descriptor with the message composite foreign key", () => {
    const sql = readFileSync(resolve(process.cwd(), "server/chat/all-mentions-migration.sql"), "utf8");
    expect(sql).toContain("PRIMARY KEY (tenant_id, conversation_id, message_id)");
    expect(sql).toContain("REFERENCES phone11_chat_messages(tenant_id, conversation_id, id)");
    expect(sql).toContain("CHECK (length = 4)");
    expect(sql).not.toContain("user_id");
  });
});
