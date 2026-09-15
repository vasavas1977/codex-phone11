import type { Request } from "express";
import type { Pool } from "pg";
import { TRPCError } from "@trpc/server";
import { getPhone11Auth, sessionHeaders, type Phone11Auth } from "../_core/phone11-auth";
import { getPool } from "../pbx/db";

/** Session IDs come from the authenticated request, never from token-registration input. */
export async function resolvePushSession(headers: Request["headers"] | undefined, userId: number,
  authService?: Phone11Auth, database?: Pool): Promise<string> {
  if (!headers || !Number.isSafeInteger(userId) || userId <= 0) throw new TRPCError({ code: "UNAUTHORIZED" });
  const current = await (authService ?? getPhone11Auth()).api.getSession({ headers: sessionHeaders(headers), query: { disableCookieCache: true, disableRefresh: true } });
  if (!current || current.session.userId !== current.user.id || !(new Date(current.session.expiresAt).getTime() > Date.now())) throw new TRPCError({ code: "UNAUTHORIZED" });
  const identity = await (database ?? getPool()).query(`SELECT 1 FROM phone11_auth_identity
    WHERE auth_user_id=$1 AND legacy_user_id=$2 AND disabled_at IS NULL`, [current.user.id, userId]);
  if (identity.rows.length !== 1) throw new TRPCError({ code: "UNAUTHORIZED" });
  return current.session.id;
}
