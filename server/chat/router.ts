import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { createChatService } from "./service";
const service = createChatService();
const tenant = z.number().int().positive();
const channel = z.object({ tenantId: tenant, id: z.string().uuid() });
const chatProcedure = protectedProcedure.use(({ ctx, next }) => {
  const expectedOwner = ctx.req.headers?.["x-phone11-chat-owner"];
  // New clients bind a queued body to the initiating actor. In browsers the
  // HttpOnly cookie can change in another tab without changing local UI state.
  // The header is an assertion only; authenticated ctx.user remains authority.
  // Omission is accepted for installed pre-header clients during rollout.
  if (expectedOwner !== undefined && expectedOwner !== String(ctx.user.id)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Your chat session changed. Open Team Chat again." });
  }
  return next();
});
export const chatRouter = router({
  list: chatProcedure.input(z.object({ tenantId: tenant.optional() }).optional()).query(({ ctx, input }) => service.list(ctx.user.id, input?.tenantId)),
  directory: chatProcedure.input(z.object({ tenantId: tenant })).query(({ ctx, input }) => service.directory(ctx.user.id, input.tenantId)),
  create: chatProcedure.input(z.object({ tenantId: tenant, kind: z.enum(["direct", "group", "channel"]), name: z.string().trim().min(1).max(100), memberIds: z.array(tenant).min(1).max(49) }))
    .mutation(({ ctx, input: i }) => service.create(ctx.user.id, i.tenantId, i.kind, i.name, i.memberIds)),
  history: chatProcedure.input(channel.extend({ before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }))
    .query(({ ctx, input: i }) => service.history(ctx.user.id, i.tenantId, i.id, i.before)),
  search: chatProcedure.input(channel.extend({ text: z.string().trim().min(2).max(100) }))
    .query(({ ctx, input: i }) => service.search(ctx.user.id, i.tenantId, i.id, i.text)),
  send: chatProcedure.input(channel.extend({ clientId: z.string().uuid(), content: z.string().trim().min(1).max(4000) }))
    .mutation(({ ctx, input: i }) => service.send(ctx.user.id, i.tenantId, i.id, i.clientId, i.content)),
  read: chatProcedure.input(channel.extend({ through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }))
    .mutation(({ ctx, input: i }) => service.read(ctx.user.id, i.tenantId, i.id, i.through)),
});
