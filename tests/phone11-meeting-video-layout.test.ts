import { describe, expect, it } from "vitest";
import {
  meetingSpeakerIdentity,
  meetingViewForRoom,
  orderMeetingVideoTiles,
} from "../lib/meetings/video-layout";

const participants = [
  { identity: "self", local: true, speaking: true },
  { identity: "remote-a", local: false, speaking: false },
  { identity: "remote-b", local: false, speaking: true },
];

describe("room-scoped local viewing", () => {
  it("defaults to Speaker and retires Gallery on room replacement or leave", () => {
    const first = {},
      second = {};
    expect(meetingViewForRoom({ room: first, layout: "gallery" }, first)).toBe(
      "gallery",
    );
    expect(meetingViewForRoom({ room: first, layout: "gallery" }, second)).toBe(
      "speaker",
    );
    expect(meetingViewForRoom({ room: first, layout: "gallery" })).toBe(
      "speaker",
    );
    expect(meetingViewForRoom({ layout: "gallery" }, first)).toBe("speaker");
  });
  it("selects the actual remote speaker ahead of a speaking local preview", () => {
    expect(meetingSpeakerIdentity(participants)).toBe("remote-b");
  });
  it("keeps simultaneous and silent speakers stable until another participant speaks", () => {
    const allSpeaking = participants.map((participant) => ({
      ...participant,
      speaking: true,
    }));
    expect(meetingSpeakerIdentity(allSpeaking, "remote-b")).toBe("remote-b");
    const silent = participants.map((participant) => ({
      ...participant,
      speaking: false,
    }));
    expect(meetingSpeakerIdentity(silent, "remote-b")).toBe("remote-b");
    expect(meetingSpeakerIdentity(participants, "remote-a")).toBe("remote-b");
  });
  it("retires departed or old-room identities and permits a camera-off speaker", () => {
    expect(meetingSpeakerIdentity(participants.slice(0, 2), "remote-b")).toBe(
      "remote-a",
    );
    expect(
      meetingSpeakerIdentity(
        [{ identity: "camera-off", local: false, speaking: true }],
        "remote-b",
      ),
    ).toBe("camera-off");
    expect(meetingSpeakerIdentity(participants.slice(0, 1))).toBe("self");
    expect(meetingSpeakerIdentity([])).toBeUndefined();
  });
  it("moves the selected tile first without mutating, losing or substituting tiles", () => {
    const cameraA = {
      identity: "remote-a",
      screenShare: false,
      key: "a",
      track: {},
    };
    const cameraB = {
      identity: "remote-b",
      screenShare: false,
      key: "b",
      track: {},
    };
    const source = Object.freeze([cameraA, cameraB]);
    expect(orderMeetingVideoTiles(source, "speaker", "remote-b")).toEqual([
      cameraB,
      cameraA,
    ]);
    expect(orderMeetingVideoTiles(source, "gallery", "remote-b")).toEqual([
      cameraA,
      cameraB,
    ]);
    expect(source).toEqual([cameraA, cameraB]);
    expect(orderMeetingVideoTiles(source, "speaker", "remote-b")[0]).toBe(
      cameraB,
    );
  });
  it.each(["speaker", "gallery"] as const)(
    "keeps all simultaneous screen shares first in %s",
    (layout) => {
      const tiles = [
        { identity: "speaker", screenShare: false, key: "camera" },
        { identity: "self", screenShare: true, key: "local-screen" },
        { identity: "remote", screenShare: true, key: "remote-screen" },
        { identity: "camera-off", screenShare: false, key: "placeholder" },
      ];
      const ordered = orderMeetingVideoTiles(tiles, layout, "speaker");
      expect(ordered.map((tile) => tile.key)).toEqual([
        "local-screen",
        "remote-screen",
        "camera",
        "placeholder",
      ]);
      expect(ordered).toHaveLength(tiles.length);
    },
  );
});
