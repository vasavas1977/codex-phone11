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
  const support = await db.query(
    "SELECT to_regclass('public.phone11_channel_meetings') IS NOT NULL AS available",
  );
  if (support.rows[0]?.available !== true) return true;
  const source = await db.query(`SELECT channel_id
    FROM phone11_channel_meetings
    WHERE meeting_id=$1 AND tenant_id=$2
      AND expires_at>clock_timestamp()+INTERVAL '5 minutes'`,
    [grant.meetingId, grant.tenantId]);
  if (!source.rows.length) {
    const originated = await db.query(`SELECT 1 FROM phone11_channel_meetings
      WHERE meeting_id=$1 AND tenant_id=$2`, [grant.meetingId, grant.tenantId]);
    return originated.rows.length === 0;
  }
  const lock = lockMembership ? " FOR KEY SHARE OF member" : "";
  const member = await db.query(`SELECT member.user_id
    FROM phone11_chat_members member
    JOIN tenant_memberships membership ON membership.tenant_id=member.tenant_id
      AND membership.user_id=member.user_id AND membership.status='active'
    JOIN tenants tenant ON tenant.id=member.tenant_id AND tenant.status='active'
    JOIN phone11_auth_identity identity ON identity.legacy_user_id=member.user_id AND identity.disabled_at IS NULL
    WHERE member.tenant_id=$1 AND member.conversation_id=$2 AND member.user_id=$3
      AND EXISTS(SELECT 1 FROM user_extensions ue JOIN extensions extension ON extension.id=ue.extension_id
        WHERE ue.user_id=member.user_id AND extension.tenant_id=member.tenant_id
          AND extension.status='active' AND extension.deleted_at IS NULL)${lock}`,
    [grant.tenantId, source.rows[0].channel_id, grant.userId]);
  if (member.rows.length !== 1) return false;
  if (!lockMembership) return true;

  // Keep the extension authority stable through the lease transaction. Start
  // and admin edits lock assignments before extensions in this same order.
  // Separate statements avoid leaving the join planner to choose lock order.
  const assignments = await db.query(`SELECT assignment.id,assignment.extension_id
    FROM user_extensions assignment
    JOIN extensions extension ON extension.id=assignment.extension_id AND extension.tenant_id=$2
    WHERE assignment.user_id=$1 ORDER BY assignment.id FOR SHARE OF assignment`,
  [grant.userId, grant.tenantId]);
  if (!assignments.rows.length) return false;
  const extensionIds = [...new Set(assignments.rows.map((row) => Number(row.extension_id)))].sort((a, b) => a - b);
  const extensions = await db.query(`SELECT id FROM extensions
    WHERE id=ANY($1::integer[]) AND tenant_id=$2 AND status='active' AND deleted_at IS NULL
    ORDER BY id FOR SHARE`, [extensionIds, grant.tenantId]);
  const eligible = new Set(extensions.rows.map((row) => Number(row.id)));
  return assignments.rows.some((row) => eligible.has(Number(row.extension_id)));
}
