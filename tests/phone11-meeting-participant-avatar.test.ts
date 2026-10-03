import { expect, it } from "vitest";
import { meetingAvatarPerson, meetingAvatarTenant } from "../lib/meetings/participant-avatar";

const person = {
  id: 1020, name: "Teammate", extension: "1020",
  photoUrl: "/api/profile/photo/7/1020?v=11111111-1111-4111-8111-111111111111",
};

it("derives the tenant only from the admitted local owner's identity", () => {
  expect(meetingAvatarTenant("p11-t7-u3001", 3001)).toBe(7);
  expect(meetingAvatarTenant("p11-t7-u3001", 3002)).toBeUndefined();
  expect(meetingAvatarTenant("p11-t07-u3001", 3001)).toBeUndefined();
  expect(meetingAvatarTenant("guest", 3001)).toBeUndefined();
});

it("maps a participant photo only by exact tenant and user ID in the authorized roster", () => {
  expect(meetingAvatarPerson("p11-t7-u1020", 7, [person])).toEqual(person);
  expect(meetingAvatarPerson("p11-t8-u1020", 7, [person])).toBeUndefined();
  expect(meetingAvatarPerson("Teammate", 7, [person])).toBeUndefined();
  expect(meetingAvatarPerson("p11-t7-u1020", undefined, [person])).toBeUndefined();
});
