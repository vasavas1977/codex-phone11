import type {
  MeetingJoinConstructorSite,
  MeetingJoinDiagnostic,
  MeetingJoinErrorType,
  MeetingJoinReason,
} from "./join-failure";

type RoomConstructor = Function & {
  prototype: { on?: unknown; setMaxListeners?: unknown };
};

function deepestError(error: unknown): Error | undefined {
  let candidate = error;
  let deepest: Error | undefined;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!(candidate instanceof Error)) break;
    deepest = candidate;
    candidate = candidate.cause;
  }
  return deepest;
}

function safeErrorType(
  error: Error | undefined,
): MeetingJoinErrorType | undefined {
  if (error instanceof ReferenceError) return "reference_error";
  if (error instanceof TypeError) return "type_error";
  if (error instanceof RangeError) return "range_error";
  if (error instanceof SyntaxError) return "syntax_error";
  if (error instanceof EvalError) return "eval_error";
  if (error instanceof URIError) return "uri_error";
  if (error instanceof Error) return "error";
  return undefined;
}

const installedConstructorFrames: readonly (readonly [
  MeetingJoinConstructorSite,
  readonly string[],
])[] = [
  [
    "data_channel",
    [
      "FlowControlledDataChannel",
      "ReliableDataChannel",
      "LossyDataChannel",
      "DataChannelManager",
    ],
  ],
  ["data_stream", ["IncomingDataStreamManager", "OutgoingDataStreamManager"]],
  ["data_track", ["IncomingDataTrackManager", "OutgoingDataTrackManager"]],
  ["signal_client", ["SignalClient"]],
  ["engine", ["RTCEngine"]],
  ["rpc", ["RpcClientManager", "RpcServerManager"]],
  ["participant", ["LocalParticipant", "Participant"]],
  ["frame_metadata", ["FrameMetadataManager"]],
  ["room", ["Room"]],
];

function safeConstructorSite(
  error: Error | undefined,
): MeetingJoinConstructorSite | undefined {
  // The first line contains Error.message and is deliberately excluded. Only
  // fixed class names from livekit-client 2.22.3 frames are considered.
  let frames: string[] = [];
  try {
    frames = error?.stack?.split("\n").slice(1) ?? [];
  } catch {
    // A nonstandard Error stack must not mask the original Room failure.
  }
  return installedConstructorFrames.find(([, names]) =>
    names.some((name) =>
      frames.some(
        (frame) =>
          frame.includes(`new ${name} (`) ||
          frame.includes(`new ${name}@`) ||
          frame.includes(` ${name}.`) ||
          frame.includes(` ${name} (`) ||
          frame.includes(` ${name}@`),
      ),
    ),
  )?.[0];
}

function hasRoomMethod(Room: RoomConstructor, key: "on" | "setMaxListeners") {
  try {
    return typeof Room.prototype?.[key] === "function";
  } catch {
    return false;
  }
}

function hasAbortController() {
  try {
    return typeof globalThis.AbortController === "function";
  } catch {
    return false;
  }
}

/** Reduces a synchronous installed-SDK Room failure without exporting text or stack. */
export function classifyRoomConstructionFailure(
  error: unknown,
  Room: RoomConstructor,
): MeetingJoinDiagnostic {
  const rootError = deepestError(error);
  let reason: MeetingJoinReason | undefined;
  let constructorSite = safeConstructorSite(rootError);

  // livekit-client 2.22.3 creates an AbortController in each of its three
  // FlowControlledDataChannel instances during new Room().
  if (!hasRoomMethod(Room, "setMaxListeners")) {
    reason = "event_emitter_incompatible";
    constructorSite = "room";
  } else if (!hasAbortController()) {
    reason = "abort_controller_missing";
    constructorSite = "data_channel";
  } else if (!hasRoomMethod(Room, "on")) {
    // FrameMetadataManager chains Room.on() near the end of construction.
    reason = "event_emitter_incompatible";
    constructorSite = "frame_metadata";
  }

  return {
    reason,
    constructorSite,
    errorType: safeErrorType(rootError),
  };
}
