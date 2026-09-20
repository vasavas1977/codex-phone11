import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { createChatService } from "./service";
const service = createChatService();
const tenant = z.number().int().positive();
const channel = z.object({ tenantId: tenant, id: z.string().uuid() });
const reportCategory = z.enum(["harassment", "spam", "safety", "other"]);
const messageAction = channel.extend({ messageId: z.string().uuid() });
const emoji = z.string().trim().min(1).max(32);
const attachmentIds = z.array(z.string().uuid()).max(10).refine(ids => new Set(ids).size === ids.length, "Attachment ids must be unique");
const mentions = z.array(z.object({ userId: tenant, start: z.number().int().nonnegative().max(4000), length: z.number().int().min(2).max(256) })).max(20)
  .refine(items => new Set(items.map(item => item.start)).size === items.length, "Mention positions must be unique");
const allMention = z.object({ start: z.number().int().nonnegative().max(3996), length: z.literal(4) }).strict();
const sendInput = channel.extend({ clientId: z.string().uuid(), content: z.string().trim().max(4000), parentMessageId: z.string().uuid().optional(), attachmentIds: attachmentIds.optional(), mentions: mentions.optional(), allMention: allMention.optional() })
  .refine(input => input.content.length > 0 || (input.attachmentIds?.length || 0) > 0, "Add a message or attachment");
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
  thread: chatProcedure.input(channel.extend({ parentMessageId: z.string().uuid(), before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }))
    .query(({ ctx, input: i }) => service.thread(ctx.user.id, i.tenantId, i.id, i.parentMessageId, i.before)),
  send: chatProcedure.input(sendInput)
    .mutation(({ ctx, input: i }) => service.send(ctx.user.id, i.tenantId, i.id, i.clientId, i.content, i.parentMessageId, i.attachmentIds, i.mentions, i.allMention)),
  details: chatProcedure.input(channel)
    .query(({ ctx, input: i }) => service.details(ctx.user.id, i.tenantId, i.id)),
  typingPublish: chatProcedure.input(channel.extend({ threadRootId: z.string().uuid().optional(), sessionId: z.string().uuid(),
    generation: z.string().uuid(), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), active: z.boolean() }).strict())
    .mutation(({ ctx, input: i }) => service.typingPublish(ctx.user.id, i.tenantId, i.id, i)),
  typing: chatProcedure.input(channel.extend({ threadRootId: z.string().uuid().optional() }).strict())
    .query(({ ctx, input: i }) => service.typing(ctx.user.id, i.tenantId, i.id, i.threadRootId)),
  setReaction: chatProcedure.input(messageAction.extend({ emoji, reacted: z.boolean() }))
    .mutation(({ ctx, input: i }) => service.setReaction(ctx.user.id, i.tenantId, i.id, i.messageId, i.emoji, i.reacted)),
  reactionUsers: chatProcedure.input(messageAction.extend({ emoji }))
    .query(({ ctx, input: i }) => service.reactionUsers(ctx.user.id, i.tenantId, i.id, i.messageId, i.emoji)),
  edit: chatProcedure.input(messageAction.extend({ content: z.string().trim().min(1).max(4000) }))
    .mutation(({ ctx, input: i }) => service.edit(ctx.user.id, i.tenantId, i.id, i.messageId, i.content)),
  delete: chatProcedure.input(messageAction)
    .mutation(({ ctx, input: i }) => service.delete(ctx.user.id, i.tenantId, i.id, i.messageId)),
  setBookmark: chatProcedure.input(messageAction.extend({ bookmarked: z.boolean() }))
    .mutation(({ ctx, input: i }) => service.setBookmark(ctx.user.id, i.tenantId, i.id, i.messageId, i.bookmarked)),
  bookmarks: chatProcedure.input(z.object({ tenantId: tenant }))
    .query(({ ctx, input: i }) => service.bookmarks(ctx.user.id, i.tenantId)),
  savedMessages: chatProcedure.input(channel)
    .query(({ ctx, input: i }) => service.savedMessages(ctx.user.id, i.tenantId, i.id)),
  setPin: chatProcedure.input(messageAction.extend({ pinned: z.boolean() }))
    .mutation(({ ctx, input: i }) => service.setPin(ctx.user.id, i.tenantId, i.id, i.messageId, i.pinned)),
  pinnedMessages: chatProcedure.input(channel)
    .query(({ ctx, input: i }) => service.pinnedMessages(ctx.user.id, i.tenantId, i.id)),
  setNotificationMute: chatProcedure.input(channel.extend({ muted: z.boolean() }))
    .mutation(({ ctx, input: i }) => service.setNotificationMute(ctx.user.id, i.tenantId, i.id, i.muted)),
  presenceCapability: chatProcedure.input(z.object({ tenantId: tenant }))
    .query(({ ctx, input: i }) => service.presenceCapability(ctx.user.id, i.tenantId)),
  heartbeat: chatProcedure.input(z.union([
    z.object({ tenantId: tenant, sessionId: z.string().uuid(), generation: z.string().uuid(),
      sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      status: z.enum(["available", "away", "on_call", "in_meeting"]), active: z.boolean() }).strict(),
    z.object({ tenantId: tenant }).strict(),
  ])).mutation(({ ctx, input: i }) => service.heartbeat(ctx.user.id, i.tenantId,
    "sessionId" in i ? { sessionId: i.sessionId, generation: i.generation, sequence: i.sequence, status: i.status, active: i.active } : undefined)),
  presence: chatProcedure.input(z.object({ tenantId: tenant, userIds: z.array(tenant).max(100).optional() }))
    .query(({ ctx, input: i }) => service.presence(ctx.user.id, i.tenantId, i.userIds)),
  forward: chatProcedure.input(channel.extend({ sourceConversationId: z.string().uuid(), sourceMessageId: z.string().uuid(), clientId: z.string().uuid() }))
    .mutation(({ ctx, input: i }) => service.forward(ctx.user.id, i.tenantId, i.id, i.sourceConversationId, i.sourceMessageId, i.clientId)),
  linkPreview: chatProcedure.input(messageAction.extend({ url: z.string().trim().min(1).max(2_048) }))
    .query(({ ctx, input: i }) => service.linkPreview(ctx.user.id, i.tenantId, i.id, i.messageId, i.url)),
  intelligenceCapability: chatProcedure.input(z.object({ tenantId: tenant }))
    .query(({ ctx, input: i }) => service.intelligenceCapability(ctx.user.id, i.tenantId)),
  summarizeThread: chatProcedure.input(channel.extend({ parentMessageId: z.string().uuid() }))
    .mutation(({ ctx, input: i }) => service.summarizeThread(ctx.user.id, i.tenantId, i.id, i.parentMessageId)),
  translateMessage: chatProcedure.input(messageAction.extend({ targetLanguage: z.string().trim().min(2).max(64) }))
    .mutation(({ ctx, input: i }) => service.translateMessage(ctx.user.id, i.tenantId, i.id, i.messageId, i.targetLanguage)),
  composeDraft: chatProcedure.input(channel.extend({ instruction: z.string().trim().min(1).max(1_000), contextMessageIds: z.array(z.string().uuid()).max(10).optional() }))
    .mutation(({ ctx, input: i }) => service.composeDraft(ctx.user.id, i.tenantId, i.id, i.instruction, i.contextMessageIds)),
  refineDraft: chatProcedure.input(channel.extend({ draft: z.string().trim().min(1).max(4_000), instruction: z.string().trim().min(1).max(1_000) }))
    .mutation(({ ctx, input: i }) => service.refineDraft(ctx.user.id, i.tenantId, i.id, i.draft, i.instruction)),
  report: chatProcedure.input(channel.extend({ category: reportCategory, comment: z.string().trim().min(1).max(500).optional(), messageId: z.string().uuid().optional() }))
    .mutation(({ ctx, input: i }) => service.report(ctx.user.id, i.tenantId, i.id, i.category, i.comment, i.messageId)),
  block: chatProcedure.input(z.object({ tenantId: tenant, userId: tenant }))
    .mutation(({ ctx, input: i }) => service.block(ctx.user.id, i.tenantId, i.userId)),
  unblock: chatProcedure.input(z.object({ tenantId: tenant, userId: tenant }))
    .mutation(({ ctx, input: i }) => service.unblock(ctx.user.id, i.tenantId, i.userId)),
  publishReadReceipts: chatProcedure.input(channel.extend({ messageIds: z.array(z.string().uuid()).min(1).max(50), threadRootId: z.string().uuid().optional() }).strict())
    .mutation(({ ctx, input: i }) => service.publishReadReceipts(ctx.user.id, i.tenantId, i.id, i.messageIds, i.threadRootId)),
  readReceiptSummaries: chatProcedure.input(channel.extend({ messageIds: z.array(z.string().uuid()).min(1).max(50), threadRootId: z.string().uuid().optional() }).strict())
    .query(({ ctx, input: i }) => service.readReceiptSummaries(ctx.user.id, i.tenantId, i.id, i.messageIds, i.threadRootId)),
  readReceiptDetails: chatProcedure.input(messageAction.extend({ threadRootId: z.string().uuid().optional() }).strict())
    .query(({ ctx, input: i }) => service.readReceiptDetails(ctx.user.id, i.tenantId, i.id, i.messageId, i.threadRootId)),
  read: chatProcedure.input(channel.extend({ through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }))
    .mutation(({ ctx, input: i }) => service.read(ctx.user.id, i.tenantId, i.id, i.through)),
});
