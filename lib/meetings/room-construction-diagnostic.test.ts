import { afterEach, describe, expect, it } from "vitest";
import { Room } from "livekit-client";

import {
  MeetingJoinFailure,
  meetingJoinFailureReference,
} from "./join-failure";
import { classifyRoomConstructionFailure } from "./room-construction-diagnostic";

const originalAbortController = globalThis.AbortController;
const originalWeakRef = globalThis.WeakRef;
const originalSetMaxListeners = Room.prototype.setMaxListeners;
const originalOn = Room.prototype.on;

afterEach(() => {
  Object.defineProperty(globalThis, "AbortController", {
    configurable: true,
    value: originalAbortController,
    writable: true,
  });
  Object.defineProperty(globalThis, "WeakRef", {
    configurable: true,
    value: originalWeakRef,
    writable: true,
  });
  Room.prototype.setMaxListeners = originalSetMaxListeners;
  Room.prototype.on = originalOn;
});

describe("installed Room constructor diagnostics", () => {
  it("constructs the real installed Room when Hermes does not provide WeakRef", () => {
    expect(Reflect.deleteProperty(globalThis, "WeakRef")).toBe(true);
    expect(typeof globalThis.WeakRef).toBe("undefined");

    expect(() => new Room()).not.toThrow();
    expect(Object.hasOwn(globalThis, "WeakRef")).toBe(false);
  });

  it("identifies the real installed data-channel failure when AbortController is absent", () => {
    Object.defineProperty(globalThis, "AbortController", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const raw = (() => {
      try {
        return new Room();
      } catch (error) {
        return error;
      }
    })();
    const diagnostic = classifyRoomConstructionFailure(raw, Room);

    expect(raw).toBeInstanceOf(TypeError);
    expect(diagnostic).toEqual({
      reason: "abort_controller_missing",
      constructorSite: "data_channel",
      errorType: "type_error",
    });
  });

  it("identifies the real installed Room base failure when EventEmitter is incompatible", () => {
    Room.prototype.setMaxListeners = undefined as never;

    const raw = (() => {
      try {
        return new Room();
      } catch (error) {
        return error;
      }
    })();
    const diagnostic = classifyRoomConstructionFailure(raw, Room);

    expect(raw).toBeInstanceOf(TypeError);
    expect(diagnostic).toEqual({
      reason: "event_emitter_incompatible",
      constructorSite: "room",
      errorType: "type_error",
    });
  });

  it("identifies the real installed frame-metadata failure when Room.on is incompatible", () => {
    Room.prototype.on = undefined as never;

    const raw = (() => {
      try {
        return new Room();
      } catch (error) {
        return error;
      }
    })();
    const diagnostic = classifyRoomConstructionFailure(raw, Room);

    expect(raw).toBeInstanceOf(TypeError);
    expect(diagnostic).toEqual({
      reason: "event_emitter_incompatible",
      constructorSite: "frame_metadata",
      errorType: "type_error",
    });
  });

  it.each([
    ["FlowControlledDataChannel", "data_channel"],
    ["OutgoingDataStreamManager", "data_stream"],
    ["IncomingDataTrackManager", "data_track"],
    ["SignalClient", "signal_client"],
    ["RTCEngine", "engine"],
    ["RpcClientManager", "rpc"],
    ["LocalParticipant", "participant"],
    ["FrameMetadataManager", "frame_metadata"],
    ["Room", "room"],
  ] as const)(
    "maps only the installed %s frame to %s",
    (frame, constructorSite) => {
      const raw = new TypeError("private token=wss://secret");
      raw.stack = `${raw.name}: ${raw.message}\n    at new ${frame} (private-bundle:1:2)`;

      expect(classifyRoomConstructionFailure(raw, Room)).toEqual({
        reason: undefined,
        constructorSite,
        errorType: "type_error",
      });
    },
  );

  it.each([
    ["    at new RTCEngine@address at main.jsbundle:1:2", "engine"],
    ["    at Room.maybeCreateEngine@address at main.jsbundle:1:2", "room"],
    ["    Room@address at main.jsbundle:1:2", "room"],
  ] as const)(
    "accepts the Hermes frame form for %s",
    (frame, constructorSite) => {
      const raw = new TypeError("private constructor detail");
      raw.stack = `${raw.name}: ${raw.message}\n${frame}`;

      expect(classifyRoomConstructionFailure(raw, Room)).toMatchObject({
        constructorSite,
        errorType: "type_error",
      });
    },
  );

  it("does not let an unusual Room prototype or Error stack mask classification", () => {
    const UnusualRoom = new Proxy(function UnusualRoom() {}, {
      get(_target, key) {
        if (key === "prototype") throw new Error("private prototype detail");
        return undefined;
      },
    }) as unknown as typeof Room;
    const raw = new TypeError("private constructor detail");
    Object.defineProperty(raw, "stack", {
      configurable: true,
      get() {
        throw new Error("private stack detail");
      },
    });

    expect(classifyRoomConstructionFailure(raw, UnusualRoom)).toEqual({
      reason: "event_emitter_incompatible",
      constructorSite: "room",
      errorType: "type_error",
    });
  });

  it("never copies malicious messages or stack frames into the public reference", () => {
    const raw = new TypeError(
      "Room wss://secret token=private participant=user-1",
    );
    raw.stack = `${raw.name}: ${raw.message}\n    at attacker (wss://secret/token=private)`;
    const failure = new MeetingJoinFailure(
      "room_create",
      classifyRoomConstructionFailure(raw, Room),
      raw,
    );

    expect(meetingJoinFailureReference(failure)).toBe(
      "room_create / type_error",
    );
    expect(meetingJoinFailureReference(failure)).not.toContain("secret");
    expect(meetingJoinFailureReference(failure)).not.toContain("private");
    expect(failure.cause).toBe(raw);
  });
});
