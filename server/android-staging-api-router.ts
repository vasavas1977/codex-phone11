import { z } from "zod";
import { getPhoneConfig } from "./phone-provisioning";
import { protectedProcedure, router } from "./_core/trpc";
import { registerPushToken, registerTokenSchema } from "./push-gateway";
import { resolvePushSession } from "./push/session";
import {
  wakeEnrollSchema,
  wakeIdentitySchema,
  wakeService,
} from "./push/wake-service";
import { WakeError } from "./push/wake-repository";

export const ANDROID_STAGING_PACKAGE = "ai.phone11.mobile.staging";

/** Registration accepted by the isolated Android API. Other platforms and app IDs belong elsewhere. */
export const androidStagingRegisterSchema = registerTokenSchema
  .extend({
    tokenType: z.literal("fcm"),
    platform: z.literal("android"),
    bundleId: z.literal(ANDROID_STAGING_PACKAGE),
    // The shared mobile client models Android as the production FCM
    // environment and therefore sends `false`. Keep `true` impossible while
    // accepting both the current client payload and older clients that omit it.
    sandbox: z.literal(false).optional(),
  })
  .strict();

const androidWakeEnrollSchema = wakeEnrollSchema
  .extend({ platform: z.literal("android") })
  .strict();

/**
 * The mobile client keeps the same tRPC names as the full Phone11 server, but
 * this staging service deliberately omits every unrelated and privileged route.
 */
export const androidStagingApiRouter = router({
  phone: router({
    getConfig: protectedProcedure.query(({ ctx }) =>
      getPhoneConfig(ctx.user.id, ctx.user.openId, {
        bootstrapSchema: false,
        allowOwnerFallback: false,
      }),
    ),
  }),
  push: router({
    register: protectedProcedure
      .input(androidStagingRegisterSchema)
      .mutation(({ input, ctx }) =>
        registerPushToken(input, ctx.user.id, ctx.req.headers),
      ),
    enrollWake: protectedProcedure
      .input(androidWakeEnrollSchema)
      .mutation(async ({ input, ctx }) => {
        const session = await resolvePushSession(ctx.req.headers, ctx.user.id);
        return wakeService.enroll(session, ctx.user.id, input);
      }),
    resolveWakeBinding: protectedProcedure
      .input(wakeIdentitySchema)
      .query(async ({ input, ctx }) => {
        const session = await resolvePushSession(ctx.req.headers, ctx.user.id);
        try {
          return await wakeService.resolve(
            session,
            ctx.user.id,
            input.bindingId,
          );
        } catch (error) {
          if (error instanceof WakeError && error.status === 403) return null;
          throw error;
        }
      }),
  }),
});

export type AndroidStagingApiRouter = typeof androidStagingApiRouter;
