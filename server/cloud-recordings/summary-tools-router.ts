import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createCloudRecordingRepository } from "./repository";
import {
  RecordingTranslationError,
  translateRecordingSummary,
} from "./summary-translation";

const callUuid = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const targetLanguage = z.enum(["th", "en", "zh", "ja", "ko"]);
const recentRequests = new Map<number, number[]>();
const limit = 6;
const windowMs = 60_000;

function translationFailure(error: unknown): {
  code: "PRECONDITION_FAILED" | "BAD_GATEWAY";
  message: string;
} {
  if (error instanceof RecordingTranslationError) {
    if (error.code === "not_configured") {
      return {
        code: "PRECONDITION_FAILED",
        message:
          "Translation needs Gemini setup. Ask a Phone11 administrator to configure it.",
      };
    }
    if (error.code === "invalid_result") {
      return {
        code: "BAD_GATEWAY",
        message: "Translation returned an incomplete result. Please try again.",
      };
    }
  }
  return {
    code: "BAD_GATEWAY",
    message: "Translation service could not complete this request. Please try again.",
  };
}

function permit(userId: number, now = Date.now()) {
  const recent = (recentRequests.get(userId) ?? []).filter(
    (value) => now - value < windowMs,
  );
  if (recent.length >= limit) return false;
  recent.push(now);
  recentRequests.set(userId, recent);
  if (recentRequests.size > 512) {
    for (const [id, times] of recentRequests) {
      if (!times.some((value) => now - value < windowMs))
        recentRequests.delete(id);
      if (recentRequests.size <= 512) break;
    }
  }
  return true;
}

export const cloudRecordingSummaryToolsRouter = router({
  translate: protectedProcedure
    .input(z.object({ callUuid, targetLanguage }))
    .mutation(async ({ ctx, input }) => {
      if (!permit(ctx.user.id))
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait before translating again.",
        });
      const repository = createCloudRecordingRepository();
      const detail = await repository.detail(ctx.user.id, input.callUuid);
      const policy = await repository.getPolicy(ctx.user.id, detail.tenantId);
      if (policy.mode === "off" || !policy.aiEnabled)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "AI call tools are disabled for this workspace.",
        });
      if (detail.summaryStatus !== "ready" || !detail.summary)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This summary is not ready to translate.",
        });
      try {
        return await translateRecordingSummary({
          targetLanguage: input.targetLanguage,
          content: {
            ...detail.summary,
            transcript: detail.transcript,
          },
        });
      } catch (error) {
        const failure = translationFailure(error);
        throw new TRPCError({
          code: failure.code,
          message: failure.message,
        });
      }
    }),
});
