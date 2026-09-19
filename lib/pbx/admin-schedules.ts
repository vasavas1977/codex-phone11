export const BUSINESS_WEEK = [1, 2, 3, 4, 5] as const;

export function isValidBusinessHours(startTime: string, endTime: string) {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  return (
    timePattern.test(startTime) &&
    timePattern.test(endTime) &&
    startTime < endTime
  );
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

function toHourMinute(value?: string | null) {
  const match = value?.match(/^(\d{2}:\d{2})/);
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
