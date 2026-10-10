export const BUSINESS_WEEK = [1, 2, 3, 4, 5] as const;
export const SCHEDULE_DAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
] as const;

export type BusinessInterval = { startTime: string; endTime: string; days?: number[]; startDate?: string; endDate?: string; label?: string };
export type HolidayRange = { startDate: string; endDate: string; label: string };
export type EditableSchedule = { intervals: BusinessInterval[]; holidays: HolidayRange[] };

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const knownRuleKeys = new Set([
  "id", "time_condition_id", "created_at", "day_of_week", "start_time",
  "end_time", "start_date", "end_date", "is_holiday", "label", "sort_order",
]);

function validDays(days: unknown): days is number[] {
  return Array.isArray(days) && days.length > 0 && days.length <= 7 &&
    Array.from(days).every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    new Set(days).size === days.length;
}

export function describeScheduleDays(days: readonly number[] = BUSINESS_WEEK) {
  if (days.length === 5 && BUSINESS_WEEK.every((day) => days.includes(day))) return "Monday to Friday";
  if (days.length === 7) return "Every day";
  return SCHEDULE_DAYS.filter((day) => days.includes(day.value)).map((day) => day.short).join(", ");
}

export function isValidBusinessHours(startTime: string, endTime: string) {
  return (
    timePattern.test(startTime) &&
    timePattern.test(endTime) &&
    startTime < endTime
  );
}

export function isValidScheduleDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidScheduleTimezone(value: string) {
  if (!value.trim() || value !== value.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateEditableSchedule(schedule: EditableSchedule): string | undefined {
  if (!schedule.intervals.length) return "Add at least one time range.";
  for (const interval of schedule.intervals) {
    if (!validDays(interval.days ?? [...BUSINESS_WEEK])) return "Select at least one day for each time range.";
    if (!isValidBusinessHours(interval.startTime, interval.endTime)) {
      return "Use 24-hour times such as 09:00 and 18:00; closing must be later than opening.";
    }
    if (Boolean(interval.startDate) !== Boolean(interval.endDate) ||
      (interval.startDate && interval.endDate &&
        (!isValidScheduleDate(interval.startDate) || !isValidScheduleDate(interval.endDate) || interval.startDate > interval.endDate))) {
      return "Use real range dates in YYYY-MM-DD format, with the end on or after the start.";
    }
  }
  for (let index = 0; index < schedule.intervals.length; index++) {
    for (let other = index + 1; other < schedule.intervals.length; other++) {
      const first = schedule.intervals[index];
      const second = schedule.intervals[other];
      const dateOverlap = !first.startDate || !first.endDate || !second.startDate || !second.endDate ||
        (first.startDate <= second.endDate && second.startDate <= first.endDate);
      const secondDays: readonly number[] = second.days ?? BUSINESS_WEEK;
      const dayOverlap = (first.days ?? BUSINESS_WEEK).some((day) => secondDays.includes(day));
      if (dayOverlap && dateOverlap && first.startTime < second.endTime && second.startTime < first.endTime) {
        return "Time ranges on the same days must not overlap.";
      }
    }
  }
  for (const holiday of schedule.holidays) {
    if (!isValidScheduleDate(holiday.startDate) || !isValidScheduleDate(holiday.endDate) || holiday.startDate > holiday.endDate) {
      return "Use real holiday dates in YYYY-MM-DD format, with the end on or after the start.";
    }
    if (holiday.label.trim().length > 240) return "Holiday names must be 240 characters or fewer.";
  }
}

export function buildScheduleRules(schedule: EditableSchedule) {
  const issue = validateEditableSchedule(schedule);
  if (issue) throw new Error(issue);
  return [
    ...schedule.intervals.map((interval, index) => ({
      day_of_week: [...(interval.days ?? BUSINESS_WEEK)],
      start_time: interval.startTime,
      end_time: interval.endTime,
      ...(interval.startDate && interval.endDate ? { start_date: interval.startDate, end_date: interval.endDate } : {}),
      is_holiday: false,
      label: interval.label ?? describeScheduleDays(interval.days),
      sort_order: index,
    })),
    ...schedule.holidays.map((holiday, index) => ({
      start_date: holiday.startDate,
      end_date: holiday.endDate,
      is_holiday: true,
      label: holiday.label.trim(),
      sort_order: schedule.intervals.length + index,
    })),
  ];
}

export function parseEditableScheduleRules(rules: unknown):
  | { ok: true; schedule: EditableSchedule }
  | { ok: false; reason: string } {
  if (!Array.isArray(rules)) return { ok: false, reason: "Schedule rules are unavailable." };
  const schedule: EditableSchedule = { intervals: [], holidays: [] };
  for (const value of rules) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: "This schedule contains an unsupported rule." };
    }
    const rule = value as Record<string, unknown>;
    if (Object.keys(rule).some((key) => !knownRuleKeys.has(key))) {
      return { ok: false, reason: "This schedule contains a rule field this editor cannot preserve." };
    }
    if (rule.is_holiday === true) {
      if (rule.day_of_week != null || rule.start_time != null || rule.end_time != null ||
        typeof rule.start_date !== "string" || typeof rule.end_date !== "string" ||
        (rule.label != null && typeof rule.label !== "string")) {
        return { ok: false, reason: "This schedule contains an unsupported holiday rule." };
      }
      schedule.holidays.push({ startDate: rule.start_date, endDate: rule.end_date, label: (rule.label as string | null) ?? "" });
    } else if (rule.is_holiday === false || rule.is_holiday == null) {
      const days = rule.day_of_week;
      const startTime = toHourMinute(rule.start_time);
      const endTime = toHourMinute(rule.end_time);
      if (!validDays(days) ||
        !startTime || !endTime ||
        ((rule.start_date != null || rule.end_date != null) &&
          (typeof rule.start_date !== "string" || typeof rule.end_date !== "string")) ||
        (rule.label != null && typeof rule.label !== "string")) {
        return { ok: false, reason: "This schedule contains an unsupported day or time rule." };
      }
      schedule.intervals.push({
        startTime, endTime,
        ...(days.length === BUSINESS_WEEK.length && BUSINESS_WEEK.every((day) => days.includes(day))
          ? {} : { days: [...days] }),
        ...(typeof rule.start_date === "string" && typeof rule.end_date === "string"
          ? { startDate: rule.start_date, endDate: rule.end_date } : {}),
        label: (rule.label as string | null) ?? undefined,
      });
    } else {
      return { ok: false, reason: "This schedule contains an unsupported rule." };
    }
  }
  const issue = validateEditableSchedule(schedule);
  return issue ? { ok: false, reason: issue } : { ok: true, schedule };
}

export function buildBusinessHoursRule(startTime: string, endTime: string) {
  if (!isValidBusinessHours(startTime, endTime)) {
    throw new Error(
      "Use valid 24-hour times and make the closing time later than opening.",
    );
  }
  return {
    day_of_week: [...BUSINESS_WEEK],
    start_time: startTime,
    end_time: endTime,
    is_holiday: false,
    label: "Monday to Friday",
    sort_order: 0,
  };
}

type ScheduleRule = {
  day_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  is_holiday?: boolean | null;
};

function toHourMinute(value: unknown) {
  const match = typeof value === "string" ? value.match(/^(\d{2}:\d{2})(?::00)?$/) : null;
  return match ? match[1] : undefined;
}

/** Uses the first regular weekday range so legacy schedules remain editable. */
export function businessHoursFromRules(rules?: ScheduleRule[] | null) {
  const weekdayRule = rules?.find((rule) =>
    !rule.is_holiday &&
    rule.day_of_week?.length === BUSINESS_WEEK.length &&
    BUSINESS_WEEK.every((day) => rule.day_of_week?.includes(day)) &&
    isValidBusinessHours(toHourMinute(rule.start_time) || "", toHourMinute(rule.end_time) || ""),
  );
  return {
    startTime: toHourMinute(weekdayRule?.start_time) || "09:00",
    endTime: toHourMinute(weekdayRule?.end_time) || "18:00",
  };
}

export function describeSchedule(schedule: {
  match_action?: string | null;
  match_target?: string | null;
  nomatch_action?: string | null;
  nomatch_target?: string | null;
}) {
  const route = (action?: string | null, target?: string | null) => {
    const label = String(action || "hangup").replaceAll("_", " ");
    return target ? `${label} ${target}` : label;
  };
  return {
    open: route(schedule.match_action, schedule.match_target),
    closed: route(schedule.nomatch_action, schedule.nomatch_target),
  };
}
