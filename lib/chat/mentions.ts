import type { ChatMention, ChatPerson } from "./types";

export type ComposerSelection = { start: number; end: number };
export type MentionTrigger = { start: number; end: number; query: string };

function clampSelection(value: string, selection: ComposerSelection) {
  const start = Math.max(0, Math.min(value.length, selection.start));
  const end = Math.max(start, Math.min(value.length, selection.end));
  return { start, end };
}

function commonEdit(previous: string, next: string) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let suffix = 0;
  while (
    suffix < previous.length - start &&
    suffix < next.length - start &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  return { start, previousEnd: previous.length - suffix, nextEnd: next.length - suffix };
}

export function selectionAfterEdit(previous: string, next: string, previousSelection?: ComposerSelection): ComposerSelection {
  if (previous === next) return { start: next.length, end: next.length };
  if (previousSelection) {
    const selection = clampSelection(previous, previousSelection);
    const insertedLength = next.length - (previous.length - (selection.end - selection.start));
    if (
      insertedLength >= 0 &&
      next.slice(0, selection.start) === previous.slice(0, selection.start) &&
      next.slice(selection.start + insertedLength) === previous.slice(selection.end)
    ) {
      const caret = selection.start + insertedLength;
      return { start: caret, end: caret };
    }
  }
  const edit = commonEdit(previous, next);
  return { start: edit.nextEnd, end: edit.nextEnd };
}

export function reconcileMentions(previous: string, next: string, mentions: ChatMention[]) {
  if (previous === next) return mentions.filter(item => next.slice(item.start, item.start + item.length) === `@${item.name}`);
  const edit = commonEdit(previous, next);
  const delta = edit.nextEnd - edit.previousEnd;
  return mentions.flatMap(item => {
    const itemEnd = item.start + item.length;
    const shifted = itemEnd <= edit.start
      ? item
      : item.start >= edit.previousEnd
        ? { ...item, start: item.start + delta }
        : null;
    return shifted && next.slice(shifted.start, shifted.start + shifted.length) === `@${shifted.name}` ? [shifted] : [];
  });
}

export function findMentionTrigger(
  value: string,
  selection: ComposerSelection,
  mentions: ChatMention[],
): MentionTrigger | null {
  const caret = clampSelection(value, selection);
  if (caret.start !== caret.end || caret.start === 0) return null;
  if (mentions.some(item => caret.start > item.start && caret.start <= item.start + item.length)) return null;
  const start = value.lastIndexOf("@", caret.start - 1);
  if (start < 0 || start >= caret.start || (start > 0 && !/\s/u.test(value[start - 1]))) return null;
  if (mentions.some(item => item.start === start && caret.start >= item.start + item.length)) return null;
  const query = value.slice(start + 1, caret.start);
  if (/[\r\n@]/u.test(query)) return null;
  return { start, end: caret.start, query };
}

export function filterMentionPeople(people: ChatPerson[], query: string) {
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!needle) return people;
  return people.filter(person =>
    `${person.name} ${person.extension || ""}`.normalize("NFKC").toLocaleLowerCase().includes(needle),
  );
}

export function insertMention(
  value: string,
  trigger: MentionTrigger,
  person: ChatPerson,
  mentions: ChatMention[],
) {
  const marker = `@${person.name}`;
  const needsSpace = trigger.end >= value.length || !/\s/u.test(value[trigger.end]);
  const replacement = `${marker}${needsSpace ? " " : ""}`;
  const nextValue = value.slice(0, trigger.start) + replacement + value.slice(trigger.end);
  const retained = reconcileMentions(value, nextValue, mentions);
  const mention = { userId: person.id, name: person.name, start: trigger.start, length: marker.length };
  const nextMentions = [...retained.filter(item => item.start !== mention.start), mention]
    .sort((left, right) => left.start - right.start);
  const caret = trigger.start + replacement.length;
  return { value: nextValue, mentions: nextMentions, selection: { start: caret, end: caret } };
}
