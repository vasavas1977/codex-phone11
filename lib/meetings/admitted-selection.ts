export type AdmittedMeeting = { meetingId: string; title?: string };

/** Presentation only. Meeting admission and joining always use the opaque ID. */
export function safeMeetingTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.normalize("NFC").trim();
  if (/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(title)) return undefined;
  const characters = Array.from(title);
  if (!title || characters.length > 100) return undefined;
  const bytes = characters.reduce((sum, character) => {
    const codePoint = character.codePointAt(0)!;
    return sum + (codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4);
  }, 0);
  if (bytes > 400) return undefined;
  return title;
}

/** Attach only titles returned for the verified tenant and already admitted IDs. */
export function admittedMeetingsWithTenantTitles(
  admitted: readonly AdmittedMeeting[],
  tenantRows: readonly { meetingId: string; tenantId: number; title?: string }[] | undefined,
  selectedTenantId: number | null,
): AdmittedMeeting[] {
  if (!selectedTenantId || !tenantRows) return admitted.map(({ meetingId }) => ({ meetingId }));
  const titles = new Map<string, string>();
  for (const row of tenantRows) {
    if (row.tenantId !== selectedTenantId) continue;
    const title = safeMeetingTitle(row.title);
    if (title) titles.set(row.meetingId, title);
  }
  return admitted.map(({ meetingId }) => ({ meetingId, title: titles.get(meetingId) }));
}

export function initialMeetingSelection(
  admittedMeetings: readonly AdmittedMeeting[] | undefined,
  initialMeetingCode: string,
) {
  if (admittedMeetings === undefined)
    return { manualEntry: true, meetingCode: initialMeetingCode };
  return {
    manualEntry: false,
    meetingCode:
      admittedMeetings.some(meeting => meeting.meetingId === initialMeetingCode)
        ? initialMeetingCode
        : initialMeetingCode ? "" : admittedMeetings.length === 1 ? admittedMeetings[0].meetingId : "",
  };
}
