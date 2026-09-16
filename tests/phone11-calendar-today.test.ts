import { expect, it } from "vitest";

import {
  phoneTodayKindLabel,
  selectPhoneTodayItems,
  type PhoneTodayItem,
} from "../lib/calendar/phone-today";

const today = new Date(2026, 8, 16, 9, 0);

const items: PhoneTodayItem[] = [
  { id: "meeting", kind: "meeting", status: "scheduled", startsAt: new Date(2026, 8, 16, 15, 0).toISOString(), title: "Weekly call" },
  { id: "finished", kind: "callback", status: "completed", startsAt: new Date(2026, 8, 16, 10, 0).toISOString(), title: "Done" },
  { id: "active", kind: "scheduled_call", status: "in_progress", startsAt: new Date(2026, 8, 16, 11, 0).toISOString(), title: "Customer call" },
  { id: "tomorrow", kind: "callback", status: "scheduled", startsAt: new Date(2026, 8, 17, 10, 0).toISOString(), title: "Tomorrow" },
  { id: "callback", kind: "callback", status: "scheduled", startsAt: new Date(2026, 8, 16, 12, 0).toISOString(), title: "Return call" },
];

it("projects only active phone calendar items for today in call-ready order", () => {
  expect(selectPhoneTodayItems(items, today).map((item) => item.id)).toEqual([
    "active",
    "callback",
    "meeting",
  ]);
});

it("labels the only three workflows that Phone11 projects", () => {
  expect(phoneTodayKindLabel("scheduled_call")).toBe("Scheduled call");
  expect(phoneTodayKindLabel("callback")).toBe("Callback");
  expect(phoneTodayKindLabel("meeting")).toBe("Meeting");
});
