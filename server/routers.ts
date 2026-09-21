import { meetingsRouter } from "./meetings/router";
import { conferenceRouter } from "./conference/router";
import { cloudRecordingsRouter } from "./cloud-recordings/router";
import { chatNotificationsRouter } from "./chat-notifications/router";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { integrationSecretStatus } from "./pbx/integration-auth";
import { findOwnedRecording } from "./pbx/media-access";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { revokePhone11Session } from "./_core/phone11-auth";
import { getPool } from "./pbx/db";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { pbxRouter } from "./pbx/pbx-router";
import { ivrRouter } from "./pbx/ivr-router";
import { chatRouter } from "./chat/router";
import { profileRouter } from "./profile/router";
import { wakeService,wakeEnrollSchema,wakeIdentitySchema } from "./push/wake-service";
import { resolvePushSession } from "./push/session";
import { WakeError } from "./push/wake-repository";
import { invokeLLM } from "./_core/llm";
import {
  getPhoneConfig,
  ensurePilotExtensionForUser,
  assignExtensionToUser,
  listExtensions,
  createExtension,
  listOrganizations,
  listDidNumbers,
  createDidNumber,
} from "./phone-provisioning";
import {
  registerPushToken,
  unregisterPushToken,
  triggerPushForUser,
  getPushStats,
  registerTokenSchema,
  unregisterTokenSchema,
  triggerPushSchema,
} from "./push-gateway";

const phoneTenantIdSchema = z.number().int().positive();

const legacyRecordingAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(12_000),
  topics: z.array(z.object({
    label: z.string().trim().min(1),
    confidence: z.number().min(0).max(100),
    description: z.string().trim().min(1),
  }).strict()).max(5),
  keyPoints: z.array(z.object({
    text: z.string().trim().min(1),
    speaker: z.enum(["caller", "callee", "unknown"]),
  }).strict()).max(6),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  sentimentScore: z.number().min(-1).max(1),
  actionItems: z.array(z.object({
    task: z.string().trim().min(1),
    assignee: z.string().trim().min(1),
    urgency: z.enum(["high", "medium", "low"]),
  }).strict()).max(5),
  language: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(80),
}).strict();

/**
 * The old phone.* management API predates the PBX router's tenant context.
 * Keep its authorization separate from the global platform-admin role: every
 * request reads the current tenant membership directly, so a revocation takes
 * effect before the next provisioning operation.
 */
async function requirePhoneTenantAdmin(
  userId: number,
  requestedTenantId?: number,
  failOnAmbiguousImplicit = false,
): Promise<number> {
  const values = requestedTenantId === undefined ? [userId] : [userId, requestedTenantId];
  const requestedClause = requestedTenantId === undefined ? "" : "AND tm.tenant_id = $2";
  const result = await getPool().query(
    `SELECT tm.tenant_id
       FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
      WHERE tm.user_id = $1
        AND tm.status = 'active'
        AND tm.role IN ('owner', 'admin')
        ${requestedClause}
      ORDER BY tm.created_at ASC, tm.tenant_id ASC`,
    values,
  );

  if (
    failOnAmbiguousImplicit &&
    requestedTenantId === undefined &&
    result.rows.length !== 1
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select a workspace before changing phone settings.",
    });
  }
  const tenantId = result.rows[0]?.tenant_id;
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
  }
  return tenantId;
}

async function listPhoneAdminTenants(userId: number): Promise<number[]> {
  const result = await getPool().query(
    `SELECT tm.tenant_id
       FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
      WHERE tm.user_id = $1
        AND tm.status = 'active'
        AND tm.role IN ('owner', 'admin')
      ORDER BY tm.created_at ASC, tm.tenant_id ASC`,
    [userId],
  );
  const tenantIds: number[] = [];
  for (const row of result.rows as Array<{ tenant_id: unknown }>) {
    const tenantId = row.tenant_id;
    if (typeof tenantId === "number" && Number.isSafeInteger(tenantId) && tenantId > 0) {
      tenantIds.push(tenantId);
    }
  }
  if (tenantIds.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
  }
  return tenantIds;
}

export const appRouter = router({
  meetings: meetingsRouter,
  conference: conferenceRouter,
  cloudRecordings: cloudRecordingsRouter,
  profile: profileRouter,
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const response = await revokePhone11Session(ctx.req.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) ctx.res.setHeader("Set-Cookie", cookies);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  /** Phone provisioning - auto-configure SIP after login */
  phone: router({
    /** Get SIP config for the logged-in user (auto-provisioning) */
    getConfig: protectedProcedure.query(async ({ ctx }) => {
      return getPhoneConfig(ctx.user.id, ctx.user.openId);
    }),

    /** Pilot: create or assign a first-device test extension for the logged-in user */
    ensurePilotConfig: protectedProcedure.mutation(async ({ ctx }) => {
      return ensurePilotExtensionForUser(ctx.user.id, ctx.user.openId);
    }),

    /** Legacy admin: list extensions only in a live administrator workspace. */
    listExtensions: protectedProcedure
      .input(z.object({ orgId: phoneTenantIdSchema.optional() }).optional())
      .query(async ({ ctx, input }) => {
        const tenantId = await requirePhoneTenantAdmin(ctx.user.id, input?.orgId);
        return listExtensions(tenantId);
      }),

    /** Legacy admin: create an extension only in a live administrator workspace. */
    createExtension: protectedProcedure
      .input(z.object({
        orgId: phoneTenantIdSchema.optional(),
        extensionNumber: z.string(),
        displayName: z.string().optional(),
        password: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tenantId = await requirePhoneTenantAdmin(ctx.user.id, input.orgId, true);
        return createExtension({ ...input, orgId: tenantId });
      }),

    /** Legacy admin: assign only inside the extension's live administrator workspace. */
    assignExtension: protectedProcedure
      .input(z.object({
        userId: z.number().int().positive(),
        extensionId: z.number().int().positive(),
        isPrimary: z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        const extension = await getPool().query(
          `SELECT tenant_id FROM extensions
            WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
            LIMIT 1`,
          [input.extensionId],
        );
        const extensionTenantId = extension.rows[0]?.tenant_id;
        if (!Number.isSafeInteger(extensionTenantId) || extensionTenantId <= 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Extension not found." });
        }
        const tenantId = await requirePhoneTenantAdmin(ctx.user.id, extensionTenantId);
        return assignExtensionToUser(input.userId, input.extensionId, input.isPrimary, tenantId);
      }),

    /** Legacy admin: return only organizations the caller can administer. */
    listOrganizations: protectedProcedure.query(async ({ ctx }) => {
      return listOrganizations(await listPhoneAdminTenants(ctx.user.id));
    }),

    /** Legacy admin: list DIDs only in a live administrator workspace. */
    listDids: protectedProcedure
      .input(z.object({ orgId: phoneTenantIdSchema.optional() }).optional())
      .query(async ({ ctx, input }) => {
        const tenantId = await requirePhoneTenantAdmin(ctx.user.id, input?.orgId);
        return listDidNumbers(tenantId);
      }),

    /** Legacy admin: create a DID only in a live administrator workspace. */
    createDid: protectedProcedure
      .input(z.object({
        orgId: phoneTenantIdSchema.optional(),
        number: z.string(),
        description: z.string().optional(),
        destinationType: z.string().default('extension'),
        destinationValue: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tenantId = await requirePhoneTenantAdmin(ctx.user.id, input.orgId, true);
        return createDidNumber({ ...input, orgId: tenantId });
      }),
  }),

  /** AI-powered call transcript analysis */
  recording: router({
    analyzeTranscript: protectedProcedure
      .input(
        z.object({
          recordingId: z.string(),
          transcription: z.string().min(1).max(100_000),
          callerName: z.string(),
          calleeName: z.string(),
          direction: z.string(),
          duration: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!await findOwnedRecording(ctx.user.id, input.recordingId)) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        const { transcription, callerName, calleeName, direction, duration } = input;

        const durationMin = Math.round(duration / 60);
        const systemPrompt = `You are an expert call analyst for a telecom operator platform called Phone11.ai. Analyze the following call transcript and extract structured insights.

The call was ${direction} between ${callerName} and ${calleeName}, lasting approximately ${durationMin} minute(s).

Return a JSON object with exactly these fields:
{
  "summary": "A concise 2-3 sentence executive summary of the call",
  "topics": [{"label": "short topic name", "confidence": 85, "description": "brief description"}],
  "keyPoints": [{"text": "key point text", "speaker": "caller|callee|unknown"}],
  "sentiment": "positive|neutral|negative|mixed",
  "sentimentScore": 0.5,
  "actionItems": [{"task": "action description", "assignee": "person name or role", "urgency": "high|medium|low"}],
  "language": "en",
  "category": "Support|Sales|Internal|Conference|General"
}

Rules:
- summary: 2-3 sentences capturing the essence of the call
- topics: 1-5 topics, each with confidence 0-100
- keyPoints: 2-6 most important statements or decisions
- sentiment: overall emotional tone of the conversation
- sentimentScore: float from -1.0 (very negative) to 1.0 (very positive)
- actionItems: 0-5 concrete next steps mentioned or implied
- language: ISO 639-1 code of the transcript language
- category: best-fit category for the call type`;

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Analyze this call transcript:\n\n${transcription}` },
            ],
            response_format: { type: "json_object" },
          });

          const rawContent = response.choices?.[0]?.message?.content;
          if (!rawContent) {
            throw new Error("Empty response from AI model");
          }

          // Content can be string or array of content parts
          const contentStr = typeof rawContent === "string"
            ? rawContent
            : (rawContent as any[]).map((p: any) => (typeof p === "string" ? p : p.text || "")).join("");

          const parsed = legacyRecordingAnalysisSchema.parse(JSON.parse(contentStr));

          // Publish only complete provider output. Missing fields remain an
          // unavailable analysis instead of becoming synthetic placeholders.
          const analysis = {
            recordingId: input.recordingId,
            analyzedAt: Date.now(),
            status: "completed" as const,
            summary: parsed.summary,
            topics: parsed.topics,
            keyPoints: parsed.keyPoints,
            sentiment: parsed.sentiment,
            sentimentScore: parsed.sentimentScore,
            actionItems: parsed.actionItems.map((item) => ({ ...item, completed: false })),
            language: parsed.language,
            category: parsed.category,
          };

          return { success: true, analysis };
        } catch (error: any) {
          console.error("[AI Analysis] Failed:", error instanceof Error ? error.name : "unknown");
          return {
            success: false,
            error: "Analysis unavailable. Please try again.",
            analysis: null,
          };
        }
      }),
   }),

  /** Push Gateway — VoIP push token management and call trigger */
  push: router({
    enrollWake: protectedProcedure.input(wakeEnrollSchema).mutation(async({input,ctx})=>{
      const session=await resolvePushSession(ctx.req.headers,ctx.user.id);
      return wakeService.enroll(session,ctx.user.id,input);
    }),
    resolveWakeBinding: protectedProcedure.input(wakeIdentitySchema).query(async({input,ctx})=>{
      const session=await resolvePushSession(ctx.req.headers,ctx.user.id);
      try{return await wakeService.resolve(session,ctx.user.id,input.bindingId);}
      catch(error){if(error instanceof WakeError && error.status===403)return null;throw error;}
    }),
    revokeWake: protectedProcedure.input(wakeIdentitySchema).mutation(async({input,ctx})=>{
      const session=await resolvePushSession(ctx.req.headers,ctx.user.id);
      await wakeService.revoke(session,ctx.user.id,input.bindingId);return {ok:true};
    }),
    /** Register a VoIP push token (called by mobile app on startup) */
    register: protectedProcedure
      .input(registerTokenSchema)
      .mutation(async ({ input, ctx }) => {
        return registerPushToken(input, ctx.user.id, ctx.req.headers);
      }),

    /** Unregister a push token (called on logout) */
    unregister: protectedProcedure
      .input(unregisterTokenSchema)
      .mutation(async ({ input, ctx }) => {
        return unregisterPushToken(input, ctx.user.id, ctx.req.headers);
      }),

    /** Trigger a VoIP push for incoming call (called by SIP proxy webhook) */
    triggerCall: publicProcedure
      .input(triggerPushSchema)
      .mutation(async ({ input, ctx }) => {
        const auth = integrationSecretStatus("PUSH_SHARED_SECRET", ctx.req.headers["x-push-secret"]);
        if (auth === "unavailable") throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Push integration is not configured" });
        if (auth !== "ok") throw new TRPCError({ code: "FORBIDDEN" });
        return triggerPushForUser(input);
      }),

    /** Admin: Get push token statistics */
    stats: adminProcedure.query(async () => {
      return getPushStats();
    }),
  }),
});
// Merge PBX router + IVR router into main router
export const fullRouter = router({
  ...appRouter._def.record,
  pbx: pbxRouter,
  ivr: ivrRouter,
  chat: chatRouter,
  chatNotifications: chatNotificationsRouter,
});

export type AppRouter = typeof fullRouter;
