/**
 * A member may see a CDR only when a call-time identity records their
 * participation. Never resolve historical access through the extension's
 * current assignee: extensions can be reassigned after a call ends.
 *
 * The leg branch accepts CDRs whose parent pre-dates identity propagation, but
 * still requires a call-time leg identity and an undeleted, same-tenant
 * extension. Rows without either immutable identity fail closed.
 */
export const SELF_SERVICE_CALL_OWNERSHIP_SQL = `(
  (cr.caller_user_id = $2 OR cr.callee_user_id = $2)
  OR EXISTS (
    SELECT 1
    FROM call_legs cl
    JOIN extensions e
      ON e.id = cl.extension_id
     AND e.tenant_id = cl.tenant_id
     AND e.deleted_at IS NULL
    WHERE cl.call_record_id = cr.id
      AND cl.tenant_id = cr.tenant_id
      AND (cl.caller_user_id = $2 OR cl.callee_user_id = $2)
  )
)`;
