/**
 * The shared calendar service owns event storage, identities and sync. Phone11
 * only projects items that have a direct calling workflow. Keeping this
 * selector pure prevents the handset from becoming a second calendar database.
 */
export type PhoneTodayItemKind = "scheduled_call" | "callback" | "meeting";

export type PhoneTodayItemStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface PhoneTodayItem {
  id: string;
  kind: PhoneTodayItemKind;
  status: PhoneTodayItemStatus;
  startsAt: string;
  title: string;
  counterpart?: string;
}

const activeStatuses = new Set<PhoneTodayItemStatus>([
  "scheduled",
  "in_progress",
]);

function dayKey(value: Date): string {
  return [value.getFullYear(), value.getMonth(), value.getDate()].join("-");
}

/** Select the current day's actionable, phone-specific shared-calendar items. */
export function selectPhoneTodayItems(
  items: readonly PhoneTodayItem[],
  now: Date = new Date(),
): PhoneTodayItem[] {
  const today = dayKey(now);
  return items
    .filter((item) => {
      const startsAt = new Date(item.startsAt);
      return !Number.isNaN(startsAt.valueOf()) && activeStatuses.has(item.status) && dayKey(startsAt) === today;
    })
    .sort((left, right) => {
      if (left.status !== right.status)
        return left.status === "in_progress" ? -1 : 1;
      return new Date(left.startsAt).valueOf() - new Date(right.startsAt).valueOf();
    });
}

export function phoneTodayKindLabel(kind: PhoneTodayItemKind): string {
  switch (kind) {
    case "scheduled_call":
      return "Scheduled call";
    case "callback":
      return "Callback";
    case "meeting":
      return "Meeting";
  }
}
