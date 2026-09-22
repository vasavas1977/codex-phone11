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
  return member.rows.length === 1;
}
