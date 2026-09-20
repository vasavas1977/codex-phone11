import { describe, expect, it } from "vitest";
import { filterMentionPeople, findMentionTrigger, insertMention, reconcileMentions, selectionAfterEdit } from "../lib/chat/mentions";

describe("chat mention composer", () => {
  it("opens for a bare @ at the caret and filters Thai member names", () => {
    expect(findMentionTrigger("พร้อม @", { start: 7, end: 7 }, [])).toEqual({ start: 6, end: 7, query: "" });
    expect(filterMentionPeople([
      { id: 1, name: "Nathasa", extension: "1001" },
      { id: 2, name: "มนตรี ใจดี", extension: "1002" },
    ], "มนตรี")).toEqual([{ id: 2, name: "มนตรี ใจดี", extension: "1002" }]);
  });

  it("does not treat email text or an existing structured mention as a new trigger", () => {
    expect(findMentionTrigger("@", { start: 0, end: 0 }, [])).toBeNull();
    expect(findMentionTrigger("a@phone11.ai", { start: 3, end: 3 }, [])).toBeNull();
    expect(findMentionTrigger("@Nathasa", { start: 4, end: 4 }, [
      { userId: 2, name: "Nathasa", start: 0, length: 8 },
    ])).toBeNull();
    expect(findMentionTrigger("@Nathasa ", { start: 9, end: 9 }, [
      { userId: 2, name: "Nathasa", start: 0, length: 8 },
    ])).toBeNull();
  });

  it("keeps a multi-word display-name query open", () => {
    expect(findMentionTrigger("@มนตรี ใ", { start: 8, end: 8 }, [])).toEqual({
      start: 0, end: 8, query: "มนตรี ใ",
    });
  });

  it("derives the caret from the replaced selection even when surrounding text repeats", () => {
    expect(selectionAfterEdit("aaaa", "aa@aa", { start: 2, end: 2 })).toEqual({ start: 3, end: 3 });
  });

  it("replaces only the active query, preserves suffix text, and records UTF-16 offsets", () => {
    const result = insertMention("Hello @มน please", { start: 6, end: 9, query: "มน" },
      { id: 4, name: "มนตรี ใจดี", extension: "1004" }, []);
    expect(result.value).toBe("Hello @มนตรี ใจดี please");
    expect(result.mentions).toEqual([{ userId: 4, name: "มนตรี ใจดี", start: 6, length: 11 }]);
    expect(result.selection).toEqual({ start: 17, end: 17 });
  });

  it("shifts multiple mentions when prior text changes and removes one edited through", () => {
    const previous = "Hi @Nathasa and @มนตรี ใจดี";
    const mentions = [
      { userId: 2, name: "Nathasa", start: 3, length: 8 },
      { userId: 4, name: "มนตรี ใจดี", start: 16, length: 11 },
    ];
    expect(reconcileMentions(previous, `Before ${previous}`, mentions)).toEqual([
      { ...mentions[0], start: 10 }, { ...mentions[1], start: 23 },
    ]);
    expect(reconcileMentions(previous, "Hi Nathasa and @มนตรี ใจดี", mentions)).toEqual([
      { ...mentions[1], start: 15 },
    ]);
  });

  it("keeps raw leading-space offsets so send-time trimming can shift them exactly", () => {
    const first = insertMention("  @na", { start: 2, end: 5, query: "na" },
      { id: 2, name: "Nathasa", extension: "1002" }, []);
    const secondValue = `${first.value}@มน`;
    const second = insertMention(secondValue, { start: first.value.length, end: secondValue.length, query: "มน" },
      { id: 4, name: "มนตรี ใจดี", extension: "1004" }, first.mentions);
    const leadingWhitespace = second.value.length - second.value.trimStart().length;
    const sent = second.mentions.map(item => ({ ...item, start: item.start - leadingWhitespace }));
    expect(second.value.trim()).toBe("@Nathasa @มนตรี ใจดี");
    expect(sent.map(item => second.value.trim().slice(item.start, item.start + item.length))).toEqual(["@Nathasa", "@มนตรี ใจดี"]);
  });
});
