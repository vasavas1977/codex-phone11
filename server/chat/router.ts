import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createChatService } from "./service";
const service = createChatService();
const tenant = z.number().int().positive();
const channel = z.object({ tenantId: tenant, id: z.string().uuid() });
export const chatRouter = router({
  list: protectedProcedure.input(z.object({ tenantId: tenant.optional() }).optional()).query(({ ctx, input }) => service.list(ctx.user.id, input?.tenantId)),
  directory: protectedProcedure.input(z.object({ tenantId: tenant })).query(({ ctx, input }) => service.directory(ctx.user.id, input.tenantId)),
  create: protectedProcedure.input(z.object({ tenantId: tenant, kind: z.enum(["direct", "group", "channel"]), name: z.string().trim().min(1).max(100), memberIds: z.array(tenant).min(1).max(49) }))
    .mutation(({ ctx, input: i }) => service.create(ctx.user.id, i.tenantId, i.kind, i.name, i.memberIds)),
  history: protectedProcedure.input(channel.extend({ before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }))
    .query(({ ctx, input: i }) => service.history(ctx.user.id, i.tenantId, i.id, i.before)),
  search: protectedProcedure.input(channel.extend({ text: z.string().trim().min(2).max(100) }))
    .query(({ ctx, input: i }) => service.search(ctx.user.id, i.tenantId, i.id, i.text)),
  send: protectedProcedure.input(channel.extend({ clientId: z.string().uuid(), content: z.string().trim().min(1).max(4000) }))
    .mutation(({ ctx, input: i }) => service.send(ctx.user.id, i.tenantId, i.id, i.clientId, i.content)),
  read: protectedProcedure.input(channel.extend({ through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }))
    .mutation(({ ctx, input: i }) => service.read(ctx.user.id, i.tenantId, i.id, i.through)),
});
