import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Pool } from "pg";
import type { Conference } from "../../lib/conference/types";
import type { ConferenceProvider, ConferenceScope } from "./service";
const flags = z.object({
  can_speak: z.boolean(),
  hold: z.boolean(),
  talking: z.boolean(),
  is_moderator: z.boolean(),
});
const member = z.object({
  type: z.string(),
  id: z.number().int().positive().optional(),
  caller_id_name: z.string().optional(),
  caller_id_number: z.string().optional(),
  join_time: z.number().nonnegative().optional(),
  flags: flags.optional(),
});
const room = z.object({
  conference_name: z.string(),
  running: z.boolean(),
  recording: z.boolean(),
  locked: z.boolean(),
  run_time: z.number().nonnegative(),
  max_members: z.number().int().positive().optional(),
  members: z.array(member),
});
const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Conference is not active" });
export function parseConferenceSnapshot(
  body: string,
  row: {
    id: string;
    provider_room: string;
    created_by: number;
    created_at: Date | string;
    can_moderate?: boolean;
    media_mode?: "audio" | "video-mcu";
  },
  now = Date.now(),
): Conference {
  const parsed = z.array(room).parse(JSON.parse(body));
  const observed = parsed.find((r) => r.conference_name === row.provider_room);
  if (!observed || !observed.running) throw missing();
  return {
    id: row.id,
    name: row.provider_room,
    canManage: row.can_moderate === true,
    joinAvailable: false,
    isLocked: observed.locked,
    mediaMode: row.media_mode ?? "audio",
    type: "instant",
    state: "active",
    bridgeNumber: "",
    createdBy: String(row.created_by),
    createdAt: new Date(row.created_at).getTime(),
    startedAt: now - observed.run_time * 1000,
    duration: observed.run_time,
    isRecording: observed.recording,
    config: {
      maxParticipants: observed.max_members ?? 0,
      recordEnabled: false,
      muteOnEntry: false,
      announceJoinLeave: false,
      waitForModerator: false,
      endWhenModeratorLeaves: false,
    },
    participants: observed.members
      .filter((m) => m.type === "caller")
      .map((m) => {
        if (!m.flags || !m.id || m.join_time === undefined)
          throw new Error("Incomplete conference observation");
        return {
          id: String(m.id),
          name: m.caller_id_name ?? "",
          extension: m.caller_id_number ?? "",
          role: m.flags.is_moderator ? "moderator" : "speaker",
          status: m.flags.hold
            ? "on-hold"
            : m.flags.can_speak
              ? "connected"
              : "muted",
          isMuted: !m.flags.can_speak,
          isOnHold: m.flags.hold,
          isSpeaking: m.flags.talking,
          joinedAt: now - m.join_time * 1000,
          audioLevel: 0,
        };
      }),
  };
}
/** Only provisioned room mappings are addressable; never accept caller-chosen ESL names. */
export function createProvisionedConferenceProvider(
  db: Pick<Pool, "query">,
  transport: { api(command: string): Promise<string> },
): ConferenceProvider {
  async function rows(scope: ConferenceScope, id?: string) {
    const result = await db.query(
      `SELECT r.*,(r.created_by=$1 OR tm.role IN ('owner','admin')) AS can_moderate FROM phone11_conference_rooms r
   JOIN tenant_memberships tm ON tm.tenant_id=r.tenant_id AND tm.user_id=$1 AND tm.status='active'
   JOIN tenants t ON t.id=r.tenant_id AND t.status='active'
   WHERE r.tenant_id=$2 AND ($3::uuid IS NULL OR r.id=$3) AND (r.created_by=$1 OR tm.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM phone11_conference_members m WHERE m.room_id=r.id AND m.user_id=$1)) ORDER BY r.created_at DESC LIMIT 100`,
      [scope.userId, scope.tenantId, id ?? null],
    );
    for (const r of result.rows)
      if (
        !/^p11_t[1-9][0-9]*_[a-zA-Z0-9_-]+$/.test(r.provider_room) ||
        !r.provider_room.startsWith(`p11_t${scope.tenantId}_`) ||
        r.provider_room.length > 100
      )
        throw new Error("Invalid conference mapping");
    return result.rows;
  }
  async function detail(scope: ConferenceScope, id: string) {
    const mapped = (await rows(scope, id))[0];
    if (!mapped) throw missing();
    return parseConferenceSnapshot(
      await transport.api(`conference ${mapped.provider_room} json_list`),
      mapped,
    );
  }
  return {
    async available(scope) {
      try {
        await rows(scope);
        z.array(room).parse(
          JSON.parse(await transport.api("conference json_list")),
        );
        return true;
      } catch {
        return false;
      }
    },
    async list(scope) {
      const mapped = await rows(scope),
        body = await transport.api("conference json_list");
      const observed = z.array(room).parse(JSON.parse(body));
      return mapped
        .filter((r) =>
          observed.some(
            (o) => o.conference_name === r.provider_room && o.running,
          ),
        )
        .map((r) => parseConferenceSnapshot(body, r));
    },
    detail,
    async execute(scope, operation) {
      if (operation.type === "create" || operation.type === "addParticipant")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Conference provisioning is unavailable",
        });
      const mapped = (await rows(scope, operation.conferenceId))[0];
      if (!mapped) throw missing();
      if (!mapped.can_moderate)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conference not found",
        });
      const before = await detail(scope, operation.conferenceId);
      let command: string;
      if (operation.type === "end") command = "kick all";
      else {
        const action = operation.action;
        if (
          "participantId" in action &&
          (!/^[1-9][0-9]*$/.test(action.participantId) ||
            !before.participants.some((p) => p.id === action.participantId))
        )
          throw missing();
        switch (action.type) {
          case "mute_participant":
            command = `mute ${action.participantId}`;
            break;
          case "unmute_participant":
            command = `unmute ${action.participantId}`;
            break;
          case "kick_participant":
            command = `kick ${action.participantId}`;
            break;
          case "mute_all":
            command = "mute all";
            break;
          case "unmute_all":
            command = "unmute all";
            break;
          case "lock_conference":
            command = "lock";
            break;
          case "unlock_conference":
            command = "unlock";
            break;
          default:
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Conference control is unavailable",
            });
        }
      }
      const reply = await transport.api(
        `conference ${mapped.provider_room} ${command}`,
      );
      if (
        !reply.trim() ||
        /-ERR|not found|does not exist|invalid|error/i.test(reply)
      )
        throw new Error("Conference command failed");
      // Observe after ACK. Missing room after kick-all is confirmed only by valid global inventory.
      if (operation.type === "end") {
        const observed = z
          .array(room)
          .parse(JSON.parse(await transport.api("conference json_list")));
        if (
          observed.some(
            (r) =>
              r.conference_name === mapped.provider_room &&
              r.running &&
              r.members.some((m) => m.type === "caller"),
          )
        )
          throw new Error("Conference end not confirmed");
        return {
          ...before,
          state: "ended",
          participants: [],
          endedAt: Date.now(),
          isRecording: false,
        };
      }
      return detail(scope, operation.conferenceId);
    },
  };
}
