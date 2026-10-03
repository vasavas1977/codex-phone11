import type { ChatAllMention } from "./types";
import type { MentionTrigger } from "./mentions";

export const ALL_MENTION_TEXT = "@all";

export function allMentionMatches(query: string): boolean {
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  return normalized.length <= 3 && "all".startsWith(normalized);
}

export function isExactAllMention(content: string, mention: ChatAllMention): boolean {
  return mention.start >= 0 && mention.length === ALL_MENTION_TEXT.length &&
    mention.start + mention.length <= content.length &&
    content.slice(mention.start, mention.start + mention.length) === ALL_MENTION_TEXT;
}

export function reconcileAllMention(previous: string, next: string, mention?: ChatAllMention): ChatAllMention | undefined {
  if (!mention) return undefined;
  const marker = previous.slice(mention.start, mention.start + mention.length);
  if (marker !== ALL_MENTION_TEXT) return undefined;
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  const previousEnd = previous.length - suffix;
  const nextEnd = next.length - suffix;
  const end = mention.start + mention.length;
  const shifted = end <= prefix ? mention : mention.start >= previousEnd
    ? { ...mention, start: mention.start + nextEnd - previousEnd } : undefined;
  return shifted && isExactAllMention(next, shifted) ? shifted : undefined;
}

export function insertAllMention(value: string, trigger: MentionTrigger, existing?: ChatAllMention) {
  const needsSpace = trigger.end >= value.length || !/\s/u.test(value[trigger.end]);
  const replacement = `${ALL_MENTION_TEXT}${needsSpace ? " " : ""}`;
  const nextValue = value.slice(0, trigger.start) + replacement + value.slice(trigger.end);
  const retained = reconcileAllMention(value, nextValue, existing);
  const allMention: ChatAllMention = { start: trigger.start, length: 4 };
  const caret = trigger.start + replacement.length;
  return { value: nextValue, allMention: retained ?? allMention, selection: { start: caret, end: caret } };
}
