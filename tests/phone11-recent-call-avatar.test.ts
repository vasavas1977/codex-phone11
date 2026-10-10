import { expect, it } from "vitest";
import { resolveRecentCallAvatar } from "../lib/phone/recent-call-avatar";

const person = {
  id: 42,
  name: "Teammate",
  extension: "3002",
  photoUrl: "/api/profile/photo/7/42?v=11111111-1111-4111-8111-111111111111",
};

it("uses a unique tenant directory extension without matching names or PSTN suffixes", () => {
  expect(resolveRecentCallAvatar("3002", [], [person], 7)).toEqual({
    kind: "team", person, tenantId: 7,
  });
  expect(resolveRecentCallAvatar("+6620303002", [], [person], 7)).toBeUndefined();
  expect(resolveRecentCallAvatar("3002", [], [person, { ...person, id: 43 }], 7)).toBeUndefined();
  expect(resolveRecentCallAvatar("3002", [], [person], undefined)).toBeUndefined();
});

it("uses a unique local photo for its exact normalized phone number", () => {
  const contact = {
    id: "local-1", name: "Friend", imageUri: "file:///private/contact.jpg",
    phones: [{ number: "0825826667", label: "Mobile", key: "+66825826667" }],
  };
  expect(resolveRecentCallAvatar("+66825826667", [contact], [], undefined)).toEqual({
    kind: "device", imageUri: contact.imageUri,
  });
  expect(resolveRecentCallAvatar("+66825826667", [contact, { ...contact, id: "local-2" }], [], undefined)).toBeUndefined();
});
