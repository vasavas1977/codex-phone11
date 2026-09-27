import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getPool } from "../pbx/db";
import { InvitationService } from "./service";
import { readInvitationConfig } from "./mailer";
import { boundedInvitationAcceptance, limitInvitationOperation } from "./rate-limit";
import { getPhone11Auth, sessionHeaders } from "../_core/phone11-auth";

const tenant = z.object({ tenantId: z.number().int().positive() });
const invitationId = tenant.extend({ invitationId: z.uuid() });
const token = z.object({ token: z.string().min(1).max(128) });
const service = () => new InvitationService(getPool(), readInvitationConfig());
const ip = (ctx: { req: { ip?: string; socket: { remoteAddress?: string } } }) => ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";

export const invitationsRouter = router({
  availability: protectedProcedure.input(tenant).query(async ({ ctx, input }) => {
    // Explicit tenant, fresh database authority even while the capability is off.
    const member = await getPool().query(`SELECT 1 FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
      WHERE tm.tenant_id=$1 AND tm.user_id=$2 AND tm.status='active' AND t.status='active'
      AND tm.role IN ('owner','admin')`, [input.tenantId, ctx.user.id]);
    if (!member.rows.length) throw new TRPCError({ code: "FORBIDDEN" });
    return { enabled: await service().available() };
  }),
  list: protectedProcedure.input(tenant).query(({ ctx, input }) => service().list(input.tenantId, ctx.user.id)),
  create: protectedProcedure.input(tenant.extend({
    email: z.email().max(254), role: z.enum(["user", "admin"]),
  })).mutation(({ ctx, input }) => {
    limitInvitationOperation("create", `${ctx.user.id}:${input.tenantId}:${ip(ctx)}`);
    return service().create(input.tenantId, ctx.user.id, input.email, input.role);
  }),
  resend: protectedProcedure.input(invitationId).mutation(({ ctx, input }) => {
    limitInvitationOperation("resend", `${ctx.user.id}:${input.tenantId}:${ip(ctx)}`);
    return service().resend(input.tenantId, ctx.user.id, input.invitationId);
  }),
  revoke: protectedProcedure.input(invitationId).mutation(({ ctx, input }) => service().revoke(input.tenantId, ctx.user.id, input.invitationId)),
  inspect: publicProcedure.input(token).mutation(({ ctx, input }) => {
    limitInvitationOperation("inspect", ip(ctx));
    return service().inspect(input.token);
  }),
  accept: publicProcedure.input(token.extend({
    name: z.string().trim().min(1).max(128).optional(),
    password: z.string().min(12).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
    limitInvitationOperation("accept", ip(ctx));
    const authenticated = ctx.user ? await getPhone11Auth().api.getSession({
      headers: sessionHeaders(ctx.req.headers), query: { disableCookieCache: true, disableRefresh: true },
    }) : null;
    const actor = ctx.user && authenticated ? {
      canonicalUserId: ctx.user.id,
      authUserId: authenticated.user.id,
      sessionId: authenticated.session.id,
    } : undefined;
    return boundedInvitationAcceptance(() => service().accept(input.token, actor, input.name, input.password));
  }),
});
