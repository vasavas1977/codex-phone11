import type { Pool } from "pg";
import type { MeetingRepository } from "./service";
// Current membership is checked for each token; application admins have no bypass.
export function createMeetingRepository(db: Pick<Pool, "query">): MeetingRepository {
  return { async authorize(userId, meetingId) {
    const { rows } = await db.query(
      `SELECT r.id, r.tenant_id FROM phone11_meeting_rooms r
       JOIN tenants t ON t.id=r.tenant_id AND t.status='active'
       JOIN tenant_memberships tm ON tm.tenant_id=r.tenant_id AND tm.user_id=$1 AND tm.status='active'
       JOIN phone11_meeting_members m ON m.meeting_id=r.id AND m.tenant_id=r.tenant_id AND m.user_id=$1
       WHERE r.id=$2 AND r.ended_at IS NULL AND m.revoked_at IS NULL`, [userId, meetingId]);
    return rows.length === 1 ? { meetingId: rows[0].id, tenantId: Number(rows[0].tenant_id), userId } : null;
  } };
}
