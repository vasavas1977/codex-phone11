import { chatNotificationsRouter } from "./chat-notifications/router";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { integrationSecretStatus } from "./pbx/integration-auth";
import { findOwnedRecording } from "./pbx/media-access";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { revokePhone11Session } from "./_core/phone11-auth";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { pbxRouter } from "./pbx/pbx-router";
import { ivrRouter } from "./pbx/ivr-router";
import { chatRouter } from "./chat/router";
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

export const appRouter = router({
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

    /** Admin: list all extensions */
    listExtensions: adminProcedure
      .input(z.object({ orgId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return listExtensions(input?.orgId ?? 1);
      }),

    /** Admin: create a new extension */
    createExtension: adminProcedure
      .input(z.object({
        orgId: z.number().default(1),
        extensionNumber: z.string(),
        displayName: z.string().optional(),
        password: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createExtension(input);
      }),

    /** Admin: assign extension to user */
    assignExtension: adminProcedure
      .input(z.object({
        userId: z.number(),
        extensionId: z.number(),
        isPrimary: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        return assignExtensionToUser(input.userId, input.extensionId, input.isPrimary);
      }),

    /** Admin: list organizations */
    listOrganizations: adminProcedure.query(async () => {
      return listOrganizations();
    }),

    /** Admin: list DID numbers */
    listDids: adminProcedure
      .input(z.object({ orgId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return listDidNumbers(input?.orgId ?? 1);
      }),

    /** Admin: create DID number */
    createDid: adminProcedure
      .input(z.object({
        orgId: z.number().default(1),
        number: z.string(),
        description: z.string().optional(),
        destinationType: z.string().default('extension'),
        destinationValue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createDidNumber(input);
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

          const parsed = JSON.parse(contentStr);

          // Validate and normalize the response
          const analysis = {
            recordingId: input.recordingId,
            analyzedAt: Date.now(),
            status: "completed" as const,
            summary: parsed.summary || "No summary available.",
            topics: Array.isArray(parsed.topics)
              ? parsed.topics.map((t: any) => ({
                  label: t.label || "Unknown",
                  confidence: Math.min(100, Math.max(0, Number(t.confidence) || 50)),
                  description: t.description || "",
                }))
              : [],
            keyPoints: Array.isArray(parsed.keyPoints)
              ? parsed.keyPoints.map((k: any) => ({
                  text: k.text || "",
                  speaker: ["caller", "callee", "unknown"].includes(k.speaker) ? k.speaker : "unknown",
                }))
              : [],
            sentiment: ["positive", "neutral", "negative", "mixed"].includes(parsed.sentiment)
              ? parsed.sentiment
              : "neutral",
            sentimentScore: Math.min(1, Math.max(-1, Number(parsed.sentimentScore) || 0)),
            actionItems: Array.isArray(parsed.actionItems)
              ? parsed.actionItems.map((a: any) => ({
                  task: a.task || "",
                  assignee: a.assignee || "Unassigned",
                  urgency: ["high", "medium", "low"].includes(a.urgency) ? a.urgency : "medium",
                  completed: false,
                }))
              : [],
            language: parsed.language || "en",
            category: parsed.category || "General",
          };

          return { success: true, analysis };
        } catch (error: any) {
          console.error("[AI Analysis] Failed:", error.message);
          return {
            success: false,
            error: error.message || "Analysis failed",
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
