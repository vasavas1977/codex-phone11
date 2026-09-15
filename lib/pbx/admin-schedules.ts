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
