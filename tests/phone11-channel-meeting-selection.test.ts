import { expect, it } from "vitest";
import { initialMeetingSelection } from "../lib/meetings/admitted-selection";
it("selects an invited meeting only from admitted records", () => {
  expect(initialMeetingSelection([{ meetingId: "a" }, { meetingId: "b" }], "b")).toEqual({ manualEntry: false, meetingCode: "b" });
  expect(initialMeetingSelection([{ meetingId: "a" }], "unauthorized")).toEqual({ manualEntry: false, meetingCode: "" });
  expect(initialMeetingSelection([{ meetingId: "a" }], "").meetingCode).toBe("a");
  expect(initialMeetingSelection([], "a").meetingCode).toBe("");
});
