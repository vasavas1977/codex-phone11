import { expect, it } from "vitest";
import { meetingVideoPublications } from "./video-publications";

it("selects camera and screen independently with publication keys regardless of map order", () => {
  const camera = { source: "camera" }, screen = { source: "screen_share" };
  const publications = new Map([
    ["screen", { videoTrack: screen, trackSid: "screen-sid", source: "screen_share" }],
    ["camera", { videoTrack: camera, trackSid: "camera-sid", source: "camera" }],
  ]);
  expect(meetingVideoPublications(publications)).toEqual([
    { key: "screen-sid:screen_share", track: screen, screenShare: true },
    { key: "camera-sid:camera", track: camera, screenShare: false },
  ]);
  expect(meetingVideoPublications(new Map([...publications].reverse())).map(v => v.key).sort())
    .toEqual(meetingVideoPublications(publications).map(v => v.key).sort());
});

it("omits unavailable, muted and unsubscribed tracks and does not retain removed publications", () => {
  const screen = { source: "screen_share" };
  const publications = new Map([
    ["missing", {}],
    ["muted", { videoTrack: screen, isMuted: true }],
    ["unsubscribed", { videoTrack: screen, isSubscribed: false }],
    ["live", { track: screen }],
  ]);
  expect(meetingVideoPublications(publications)).toEqual([
    { key: "live:screen_share", track: screen, screenShare: true },
  ]);
  publications.delete("live");
  expect(meetingVideoPublications(publications)).toEqual([]);
  expect(meetingVideoPublications()).toEqual([]);
});

it("replaces the live track while preserving the publication key and legacy camera fallback", () => {
  const original = {}, replacement = {};
  const publications = new Map([["camera", { videoTrack: original }]]);
  expect(meetingVideoPublications(publications)).toEqual([
    { key: "camera:camera", track: original, screenShare: false },
  ]);
  publications.set("camera", { videoTrack: replacement });
  expect(meetingVideoPublications(publications)[0]).toEqual({ key: "camera:camera", track: replacement, screenShare: false });
});
