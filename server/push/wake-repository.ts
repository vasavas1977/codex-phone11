import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../pbx/db";

type Transaction = <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
export type WakeStatus = "pending" | "ready" | "cancelled" | "expired" | "ended";
export interface WakeBinding {
  bindingId: string; ownerUserId: number; tenantId: number; deviceId: string;
  sessionBinding: string; expiresAt: number;
}
export interface WakeCall { v: 1; callUUID: string; bindingId: string; expiresAt: number; status: WakeStatus; }
export class WakeError extends Error {
  constructor(public readonly status: number, message = "This incoming call is unavailable") { super(message); }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const binding = (r: any): WakeBinding => ({ bindingId: r.id, ownerUserId: Number(r.user_id), tenantId: Number(r.tenant_id),
  deviceId: r.device_id, sessionBinding: r.session_binding, expiresAt: new Date(r.expires_at).getTime() });
const call = (r: any): WakeCall => ({ v: 1, callUUID: r.id, bindingId: r.binding_id,
  expiresAt: new Date(r.expires_at).getTime(), status: ["cancelled","ended"].includes(r.state) ? r.state
    : r.state==="ready" && r.busy ? "ready" : r.expired ? "expired" : r.state });

// Resolve both the exact saved push revision and the current assignment/session.
// Unregister, logout or assignment change invalidates a grant. Same-identity token refresh preserves it.
const livePush = `JOIN phone11_auth_session auths ON auths.id=p.session_id AND auths."expiresAt">clock_timestamp()
 JOIN phone11_auth_identity ai ON ai.auth_user_id=auths."userId" AND ai.legacy_user_id=p.user_id AND ai.disabled_at IS NULL
 JOIN user_extensions ue ON ue.user_id=p.user_id AND ue.extension_id=p.extension_id
 JOIN extensions e ON e.id=p.extension_id AND e.tenant_id=p.tenant_id AND e.status='active' AND e.deleted_at IS NULL
 JOIN tenants t ON t.id=p.tenant_id AND t.status='active'
 JOIN sip_accounts sa ON sa.extension_id=e.id AND sa.tenant_id=t.id AND sa.status='active' AND sa.deleted_at IS NULL
 AND ('sip:'||sa.sip_username||'@'||lower(sa.sip_domain))=p.sip_uri`;
const liveBinding = `JOIN phone11_push_devices p ON p.revision=b.push_revision AND p.session_id=b.session_id
 AND p.user_id=b.user_id AND p.tenant_id=b.tenant_id AND p.extension_id=b.extension_id AND p.device_id=b.device_id
 AND p.platform='ios' AND p.token_type='voip' ${livePush}`;

export function createWakeRepository(runTransaction: Transaction = withTransaction) {
  const transaction:Transaction=fn=>runTransaction(async client=>{
    // HTTP cancellation cannot interrupt a pg statement already waiting for a
    // lock. Bound the actual database work as well as the service response.
    await client.query("SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
    return fn(client);
  });
  async function authenticate(client: PoolClient, bindingId: string, grant?: string, session?: { id: string; userId: number }) {
    // Logout cascades session -> push -> binding; token refresh locks push ->
    // binding. Acquire authority rows first, then push, then binding explicitly.
    await client.query(`SELECT auths.id FROM phone11_auth_session auths
      JOIN phone11_wake_bindings b ON b.session_id=auths.id WHERE b.id=$1 FOR SHARE OF auths`, [bindingId]);
    await client.query(`SELECT p.revision FROM phone11_wake_bindings b ${liveBinding}
      WHERE b.id=$1 FOR SHARE OF ai,ue,e,t,sa`, [bindingId]);
    await client.query(`SELECT p.revision FROM phone11_push_devices p
      JOIN phone11_wake_bindings b ON p.session_id=b.session_id AND p.user_id=b.user_id
        AND p.tenant_id=b.tenant_id AND p.extension_id=b.extension_id AND p.device_id=b.device_id
      WHERE b.id=$1 FOR SHARE OF p`, [bindingId]);
    const rows = await client.query(`SELECT b.*,p.sip_uri FROM phone11_wake_bindings b ${liveBinding}
      WHERE b.id=$1 AND b.expires_at>clock_timestamp()
      AND (($2::text IS NOT NULL AND b.grant_hash=$2) OR ($3::text IS NOT NULL AND b.session_id=$3 AND b.user_id=$4))
      FOR SHARE OF b,p,auths,ai,ue,e,t,sa`, [bindingId, grant ? hash(grant) : null, session?.id ?? null, session?.userId ?? null]);
    if (rows.rows.length !== 1) throw new WakeError(403);
    return rows.rows[0];
  }
  // Opportunistic bounded cleanup: runs before new offers, independently of
  // authority locks. SKIP LOCKED never waits on an active call transaction.
  async function pruneExpired() {
    await transaction(async client => {
      await client.query(`DELETE FROM phone11_wake_calls WHERE id IN (
        SELECT id FROM phone11_wake_calls WHERE expires_at<clock_timestamp()-interval '24 hours'
        AND (busy_until IS NULL OR busy_until<clock_timestamp())
        ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`);
      await client.query(`DELETE FROM phone11_wake_terminals WHERE (sip_uri,sip_call_id) IN (
        SELECT sip_uri,sip_call_id FROM phone11_wake_terminals WHERE expires_at<clock_timestamp()
        ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`);
    });
  }
  return {
    pruneExpired,
    async enroll(sessionId: string, userId: number, deviceId: string, pilotUri: string) {
      return transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`phone11-wake:${pilotUri}`]);
        await client.query('SELECT id FROM phone11_auth_session WHERE id=$1 FOR SHARE', [sessionId]);
        await client.query(`SELECT p.revision FROM phone11_push_devices p ${livePush}
          WHERE p.session_id=$1 AND p.user_id=$2 AND p.device_id=$3 AND p.sip_uri=$4
          FOR SHARE OF ai,ue,e,t,sa`, [sessionId,userId,deviceId,pilotUri]);
        const result = await client.query(`SELECT p.*,auths."expiresAt" AS session_expiry FROM phone11_push_devices p ${livePush}
          WHERE p.session_id=$1 AND p.user_id=$2 AND p.device_id=$3 AND p.platform='ios' AND p.token_type='voip'
          AND p.sip_uri=$4 FOR SHARE OF p,auths,ai,ue,e,t,sa`, [sessionId,userId,deviceId,pilotUri]);
        if (result.rows.length !== 1) throw new WakeError(403, "Register this phone before enabling incoming call wake");
        const p = result.rows[0];
        // Reclaim revoked/expired enrollment; an invalid grant must not lock out a new phone.
        await client.query(`DELETE FROM phone11_wake_bindings old WHERE old.tenant_id=$1 AND old.extension_id=$2
          AND (old.expires_at<=clock_timestamp() OR NOT EXISTS (SELECT 1 FROM phone11_wake_bindings b ${liveBinding}
            WHERE b.id=old.id))`, [p.tenant_id,p.extension_id]);
        // One phone per pilot account. Never silently replace a live different device/user.
        const existing = await client.query("SELECT * FROM phone11_wake_bindings WHERE tenant_id=$1 AND extension_id=$2 FOR UPDATE", [p.tenant_id,p.extension_id]);
        if (existing.rows.some(b => b.user_id !== userId || b.device_id !== deviceId)) throw new WakeError(409, "Another phone is enrolled for this pilot account");
        if (existing.rows.length && (await client.query("SELECT 1 FROM phone11_wake_calls WHERE binding_id=$1 AND state IN ('pending','ready') AND (expires_at>clock_timestamp() OR busy_until>clock_timestamp())",[existing.rows[0].id])).rows.length) {
          throw new WakeError(409,"Finish the pending call before refreshing incoming call wake");
        }
        await client.query("DELETE FROM phone11_wake_bindings WHERE tenant_id=$1 AND extension_id=$2", [p.tenant_id,p.extension_id]);
        const grant = randomBytes(32).toString("base64url");
        const rows = await client.query(`INSERT INTO phone11_wake_bindings
          (id,session_id,session_binding,user_id,tenant_id,extension_id,device_id,push_revision,grant_hash,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,LEAST($10::timestamptz,clock_timestamp()+interval '7 days')) RETURNING *`,
          [randomUUID(),sessionId,randomUUID(),userId,p.tenant_id,p.extension_id,deviceId,p.revision,hash(grant),p.session_expiry]);
        const fresh = await authenticate(client,rows.rows[0].id,grant);
        return { ...binding(fresh), grant };
      });
    },
    async resolve(bindingId: string, sessionId: string, userId: number) {
      return transaction(async client => binding(await authenticate(client,bindingId,undefined,{id:sessionId,userId})));
    },
    async revoke(bindingId: string, sessionId: string, userId: number) {
      await transaction(client => client.query("DELETE FROM phone11_wake_bindings WHERE id=$1 AND session_id=$2 AND user_id=$3", [bindingId,sessionId,userId]));
    },
    async offer(sipUri: string, sipCallId: string) {
      await pruneExpired();
      return transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`phone11-wake:${sipUri}`]);
        await client.query(`SELECT auths.id FROM phone11_auth_session auths
          JOIN phone11_push_devices p ON p.session_id=auths.id WHERE p.sip_uri=$1 ORDER BY auths.id FOR SHARE OF auths`, [sipUri]);
        await client.query(`SELECT p.revision FROM phone11_push_devices p ${livePush}
          WHERE p.sip_uri=$1 FOR SHARE OF ai,ue,e,t,sa`, [sipUri]);
        await client.query("SELECT revision FROM phone11_push_devices WHERE sip_uri=$1 FOR SHARE", [sipUri]);
        const rows = await client.query(`SELECT b.*,p.sip_uri FROM phone11_wake_bindings b ${liveBinding}
          WHERE p.sip_uri=$1 AND b.expires_at>clock_timestamp() FOR SHARE OF b,p,auths,ai,ue,e,t,sa`, [sipUri]);
        if (rows.rows.length !== 1) throw new WakeError(404, "No enrolled phone is available");
        const b = rows.rows[0];
        // Row update lock serializes call creation without reversing enrollment's account-lock order.
        await client.query("SELECT id FROM phone11_wake_bindings WHERE id=$1 FOR UPDATE", [b.id]);
        const prior = await client.query("SELECT *,expires_at<=clock_timestamp() AS expired,busy_until>clock_timestamp() AS busy FROM phone11_wake_calls WHERE binding_id=$1 AND sip_call_id=$2", [b.id,sipCallId]);
        if (prior.rows.length) return { call: call(prior.rows[0]), created: false };
        const terminal = await client.query("SELECT 1 FROM phone11_wake_terminals WHERE sip_uri=$1 AND sip_call_id=$2 AND expires_at>clock_timestamp()", [sipUri,sipCallId]);
        if (terminal.rows.length) throw new WakeError(410);
        const busy = await client.query("SELECT 1 FROM phone11_wake_calls WHERE binding_id=$1 AND state IN ('pending','ready') AND (expires_at>clock_timestamp() OR busy_until>clock_timestamp())", [b.id]);
        if (busy.rows.length) throw new WakeError(409, "Phone already has a pending incoming call");
        const inserted = await client.query(`INSERT INTO phone11_wake_calls (id,binding_id,sip_call_id,sip_uri,state,expires_at)
          VALUES ($1,$2,$3,$4,'pending',LEAST($5::timestamptz,clock_timestamp()+interval '30 seconds')) RETURNING *,false AS expired`,
          [randomUUID(),b.id,sipCallId,sipUri,b.expires_at]);
        try { await authenticate(client,b.id,undefined,{id:b.session_id,userId:b.user_id}); }
        catch(error) { if(error instanceof WakeError && error.status===403) throw new WakeError(404); throw error; }
        return { call: call(inserted.rows[0]), created: true };
      });
    },
    async current(callUUID: string) {
      return transaction(async client => {
        const rows = await client.query(`SELECT c.*,c.expires_at<=clock_timestamp() AS expired,c.busy_until>clock_timestamp() AS busy FROM phone11_wake_calls c
          JOIN phone11_wake_bindings b ON b.id=c.binding_id ${liveBinding}
          WHERE c.id=$1 AND b.expires_at>clock_timestamp()`, [callUUID]);
        return rows.rows.length===1 ? call(rows.rows[0]) : null;
      });
    },
    async deliveryTarget(callUUID: string) {
      return transaction(async client => {
        const rows=await client.query(`SELECT b.push_revision,p.sip_uri FROM phone11_wake_calls c
          JOIN phone11_wake_bindings b ON b.id=c.binding_id ${liveBinding}
          WHERE c.id=$1 AND c.state='pending' AND c.expires_at>clock_timestamp() AND b.expires_at>clock_timestamp()`,[callUUID]);
        if (rows.rows.length!==1) throw new WakeError(410);
        return { revision:rows.rows[0].push_revision as string,sipUri:rows.rows[0].sip_uri as string };
      });
    },
    async transitionTrusted(sipUri: string, sipCallId: string, status: "cancelled" | "ended") {
      await transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`phone11-wake:${sipUri}`]);
        // Retain terminal-first delivery across process restarts and delayed offers.
        await client.query(`INSERT INTO phone11_wake_terminals (sip_uri,sip_call_id,state,expires_at)
          VALUES ($1,$2,$3,clock_timestamp()+interval '5 minutes')
          ON CONFLICT (sip_uri,sip_call_id) DO NOTHING`, [sipUri,sipCallId,status]);
        await client.query(`UPDATE phone11_wake_calls SET state=$3 WHERE sip_uri=$1 AND sip_call_id=$2
          AND state IN ('pending','ready')`, [sipUri,sipCallId,status]);
      });
    },
    async deviceCall(bindingId: string, grant: string, callUUID: string, action: "claim" | "ready" | "status" | "end") {
      return transaction(async client => {
        const b = await authenticate(client,bindingId,grant);
        const rows = await client.query("SELECT *,expires_at<=clock_timestamp() AS expired,busy_until>clock_timestamp() AS busy FROM phone11_wake_calls WHERE id=$1 AND binding_id=$2 FOR UPDATE", [callUUID,bindingId]);
        if (rows.rows.length!==1) throw new WakeError(404);
        let c=rows.rows[0];
        if (action==="end" && ["pending","ready"].includes(c.state)) {
          c=(await client.query("UPDATE phone11_wake_calls SET state='ended' WHERE id=$1 RETURNING *,expires_at<=clock_timestamp() AS expired", [callUUID])).rows[0];
        }
        if (action==="ready" && ((!c.expired && c.state==="pending") || (c.state==="ready" && c.busy))) {
          c=(await client.query("UPDATE phone11_wake_calls SET state='ready',busy_until=clock_timestamp()+interval '90 seconds' WHERE id=$1 RETURNING *,expires_at<=clock_timestamp() AS expired,true AS busy", [callUUID])).rows[0];
        }
        const result=call(c);
        if (action!=="claim") {
          await authenticate(client,bindingId,grant);
          return result;
        }
        if (c.expired || !["pending","ready"].includes(result.status)) throw new WakeError(410);
        // Read only the same assigned SIP subscriber used by foreground provisioning.
        // No schema creation, credential rotation, fallback account or cross-tenant lookup.
        const sipRows=await client.query(`SELECT sa.sip_username,sa.sip_domain,sa.transport_preference,sub.password
          FROM sip_accounts sa JOIN subscriber sub ON sub.username=sa.sip_username AND lower(sub.domain)=lower(sa.sip_domain)
          WHERE sa.extension_id=$1 AND sa.tenant_id=$2 AND sa.status='active' AND sa.deleted_at IS NULL
          AND ('sip:'||sa.sip_username||'@'||lower(sa.sip_domain))=$3 FOR SHARE OF sa,sub`, [b.extension_id,b.tenant_id,b.sip_uri]);
        if (sipRows.rows.length!==1 || !sipRows.rows[0].password) throw new WakeError(503);
        await authenticate(client,bindingId,grant);
        if ((await client.query("SELECT expires_at<=clock_timestamp() AS expired FROM phone11_wake_calls WHERE id=$1",[callUUID])).rows[0].expired) throw new WakeError(410);
        const s=sipRows.rows[0];
        const transport=String(s.transport_preference || process.env.SIP_TRANSPORT || "UDP").toUpperCase();
        if (!["UDP","TCP","TLS"].includes(transport)) throw new WakeError(503);
        const port=Number(process.env.SIP_PORT || (transport==="TLS" ? 5061 : 5060));
        if (!Number.isInteger(port) || port<1 || port>65535) throw new WakeError(503);
        return { ...binding(b), ...result, sip: { sipServer:s.sip_domain,sipExtension:s.sip_username,sipPassword:s.password,
          sipAuthId:s.sip_username,transport,port,secureMedia:1,stunServer:process.env.SIP_STUN || "stun.l.google.com:19302" } };
      });
    },
  };
}
export const wakeRepository=createWakeRepository();
