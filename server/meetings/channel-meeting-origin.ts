import type { MeetingGrant } from "./service";
import type { PlainVideoAdmissionQuery } from "./plain-video-admission-repository";

/**
 * Legacy admissions remain valid when the additive channel migration is absent.
 * Once a room has channel provenance, every authorization rechecks its exact
 * current channel membership and the bounded room invitation lifetime.
 */
export async function channelMeetingOriginAllows(
  db: PlainVideoAdmissionQuery,
  grant: MeetingGrant,
  lockMembership = false,
): Promise<boolean> {
  if (lockMembership) {
    // Issuance must acquire this tenant row before any channel-member row.
    // Meeting start and host-permission edits also lock tenant first. A member
    // KEY SHARE before the lease's later tenant lock would reverse that order
    // and can deadlock with a concurrent start or edit. SHARE protects active
    // status while allowing other invitees in this tenant to join concurrently.
    const tenant = await db.query(`SELECT id FROM tenants
      WHERE id=$1 AND status='active' FOR SHARE`, [grant.tenantId]);
    if (tenant.rows.length !== 1) return false;
  }
  const support = await db.query(`SELECT
    to_regclass('public.phone11_channel_meetings') IS NOT NULL AS available,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='phone11_channel_meetings' AND column_name='origin_kind') AS direct_available`);
  if (support.rows[0]?.available !== true) return true;
  const hasOriginKind = support.rows[0]?.direct_available === true;
  const source = await db.query(`SELECT channel_id, created_by, ${hasOriginKind ? "origin_kind" : "'channel'::text AS origin_kind"}
    FROM phone11_channel_meetings
    WHERE meeting_id=$1 AND tenant_id=$2
      AND expires_at>clock_timestamp()+INTERVAL '5 minutes'`,
    [grant.meetingId, grant.tenantId]);
  if (!source.rows.length) {
    const originated = await db.query(`SELECT 1 FROM phone11_channel_meetings
      WHERE meeting_id=$1 AND tenant_id=$2`, [grant.meetingId, grant.tenantId]);
    return originated.rows.length === 0;
  }
  const origin = source.rows[0];
  const originKind = hasOriginKind ? origin.origin_kind : "channel";
  let directPair: [number, number] | null = null;
  if (originKind === "direct") {
    if (!hasOriginKind) return false;
    if (lockMembership) {
      // Member insertion takes a foreign-key KEY SHARE on this parent row.
      // UPDATE prevents a third member or a kind change until token issuance
      // commits, so the exact pair count remains authoritative.
      const conversation = await db.query(`SELECT id FROM phone11_chat_conversations
        WHERE tenant_id=$1 AND id=$2 AND kind='direct' FOR UPDATE`,
      [grant.tenantId, origin.channel_id]);
      if (conversation.rows.length !== 1) return false;
    }
    const pair = await db.query(`SELECT member.user_id FROM phone11_chat_conversations conversation
      JOIN phone11_chat_members member ON member.tenant_id=conversation.tenant_id
        AND member.conversation_id=conversation.id
      WHERE conversation.tenant_id=$1 AND conversation.id=$2 AND conversation.kind='direct'
      ORDER BY member.user_id LIMIT 3${lockMembership ? " FOR KEY SHARE OF member" : ""}`,
    [grant.tenantId, origin.channel_id]);
    if (pair.rows.length !== 2 || !pair.rows.some((row) => Number(row.user_id) === grant.userId)
      || !pair.rows.some((row) => Number(row.user_id) === Number(origin.created_by))) return false;
    const [first, second] = pair.rows.map((row) => Number(row.user_id)).sort((a, b) => a - b);
    directPair = [first, second];
  } else if (originKind !== "channel") return false;
  const lock = lockMembership ? " FOR KEY SHARE OF member" : "";
  const member = await db.query(`SELECT member.user_id
    FROM phone11_chat_members member
    JOIN phone11_chat_conversations conversation ON conversation.tenant_id=member.tenant_id
      AND conversation.id=member.conversation_id
    JOIN tenant_memberships membership ON membership.tenant_id=member.tenant_id
      AND membership.user_id=member.user_id AND membership.status='active'
    JOIN tenants tenant ON tenant.id=member.tenant_id AND tenant.status='active'
    JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
    WHERE member.tenant_id=$1 AND member.conversation_id=$2 AND member.user_id=ANY($3::integer[])
      AND conversation.kind ${originKind === "direct" ? "= 'direct'" : "IN ('group','channel')"}
      AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
        WHERE ue.user_id=member.user_id AND extension.tenant_id=member.tenant_id
          AND extension.status='active' AND extension.deleted_at IS NULL)${lock}`,
    [grant.tenantId, origin.channel_id, directPair ?? [grant.userId]]);
  // A direct room is only admitted while *both* people remain eligible. The
  // host can lose workspace or extension authority after sending an invite.
  if (member.rows.length !== (directPair ? 2 : 1)) return false;
  if (!lockMembership) {
    if (!directPair) return true;
    const [first, second] = directPair;
    const block = await db.query(`SELECT 1 FROM phone11_chat_blocks WHERE tenant_id=$1
      AND ((blocker_id=$2 AND blocked_id=$3) OR (blocker_id=$3 AND blocked_id=$2)) LIMIT 1`,
    [grant.tenantId, first, second]);
    return block.rows.length === 0;
  }

  if (directPair) {
    // The later lease CTE upgrades these two rows to UPDATE. Take those
    // locks before the chat pair lock: block's workspace check takes SHARE
    // on the same authority rows before it takes the pair lock.
    const membership = await db.query(`SELECT user_id FROM tenant_memberships
      WHERE tenant_id=$1 AND user_id=ANY($2::integer[]) AND status='active'
      ORDER BY user_id FOR UPDATE`, [grant.tenantId, directPair]);
    const identity = await db.query(`SELECT legacy_user_id FROM phone11_auth_identity
      WHERE legacy_user_id=ANY($1::integer[]) AND disabled_at IS NULL
      ORDER BY legacy_user_id FOR UPDATE`, [directPair]);
    if (membership.rows.length !== 2 || identity.rows.length !== 2) return false;
  }

  // Keep the extension authority stable through the lease transaction. Start
  // and admin edits lock assignments before extensions in this same order.
  // Separate statements avoid leaving the join planner to choose lock order.
  const eligibleUsers = directPair ?? [grant.userId];
  const assignments = await db.query(`SELECT assignment.id,assignment.user_id,assignment.extension_id
    FROM user_extensions assignment
    JOIN extensions extension ON extension.id=assignment.extension_id AND extension.tenant_id=$2
    WHERE assignment.user_id=ANY($1::integer[]) ORDER BY assignment.user_id,assignment.id FOR SHARE OF assignment`,
  [eligibleUsers, grant.tenantId]);
  if (!assignments.rows.length) return false;
  const extensionIds = [...new Set(assignments.rows.map((row) => Number(row.extension_id)))].sort((a, b) => a - b);
  const extensions = await db.query(`SELECT id FROM extensions
    WHERE id=ANY($1::integer[]) AND tenant_id=$2 AND status='active' AND deleted_at IS NULL
    ORDER BY id FOR SHARE`, [extensionIds, grant.tenantId]);
  const eligible = new Set(extensions.rows.map((row) => Number(row.id)));
  if (!eligibleUsers.every((userId) => assignments.rows.some((row) =>
    Number(row.user_id) === userId && eligible.has(Number(row.extension_id))))) return false;
  if (!directPair) return true;
  const [first, second] = directPair;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`phone11-chat-safety:${grant.tenantId}:${first}:${second}`]);
  const block = await db.query(`SELECT 1 FROM phone11_chat_blocks WHERE tenant_id=$1
    AND ((blocker_id=$2 AND blocked_id=$3) OR (blocker_id=$3 AND blocked_id=$2)) LIMIT 1`,
  [grant.tenantId, first, second]);
  return block.rows.length === 0;
}
