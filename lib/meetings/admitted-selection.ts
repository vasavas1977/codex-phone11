export type AdmittedMeeting = { meetingId: string };

export function initialMeetingSelection(
  admittedMeetings: readonly AdmittedMeeting[] | undefined,
  initialMeetingCode: string,
) {
  if (admittedMeetings === undefined)
    return { manualEntry: true, meetingCode: initialMeetingCode };
  return {
    manualEntry: false,
    meetingCode:
      admittedMeetings.length === 1 ? admittedMeetings[0].meetingId : "",
  };
}
