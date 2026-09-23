import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getPool } from "../pbx/db";
import { createProfileService, dndDurationMinutes, ProfileStatusUnavailableError, ProfileWorkspaceAccessError, statusExpiryPresets } from "./service";
import { manualAvailabilityValues, workLocationValues } from "./status";
import { authorizeWorkspace } from "../chat/service";
import { MAX_PROFILE_PHOTO_BYTES, profilePhotoCommissioned, profilePhotosAvailable, profilePhotoStorageReady } from "./photo";

const tenantId = z.number().int().positive();
const manualAvailability = z.enum(manualAvailabilityValues);
const workLocation = z.enum(workLocationValues);
const dndDuration = z.union(dndDurationMinutes.map(value => z.literal(value)) as [z.ZodLiteral<20>, z.ZodLiteral<60>, z.ZodLiteral<240>, z.ZodLiteral<480>, z.ZodLiteral<1440>]);
const availabilityInput = z.object({
  value: manualAvailability.nullable(),
  expiresInMinutes: dndDuration.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.value === "dnd" && input.expiresInMinutes === undefined) {
    ctx.addIssue({ code: "custom", path: ["expiresInMinutes"], message: "Choose when Do not disturb ends." });
  }
  if (input.value !== "dnd" && input.expiresInMinutes !== undefined) {
    ctx.addIssue({ code: "custom", path: ["expiresInMinutes"], message: "Only Do not disturb has a timed expiry." });
  }
});
const statusInput = z.object({
  text: z.string().trim().max(280).nullable(),
  expiry: z.enum(statusExpiryPresets).optional(),
}).strict().superRefine((input, ctx) => {
  if (!input.text && input.expiry !== undefined && input.expiry !== "always") {
    ctx.addIssue({ code: "custom", path: ["expiry"], message: "A status is required for an expiry." });
  }
});

export const profileUpdateSchema = z.object({
  tenantId,
  availability: availabilityInput.optional(),
  status: statusInput.optional(),
  workLocation: workLocation.nullable().optional(),
}).strict().refine(input => input.availability !== undefined || input.status !== undefined || input.workLocation !== undefined, {
  message: "Choose a profile setting to update.",
});

function trpcError(error: unknown): never {
  if (error instanceof ProfileStatusUnavailableError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Profile status needs a workspace update." });
  }
  if (error instanceof ProfileWorkspaceAccessError) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This workspace is unavailable for your account." });
  }
  throw error;
}

export function createProfileRouter(service?: ReturnType<typeof createProfileService>) {
  let resolvedService = service;
  const currentService = () => (resolvedService ??= createProfileService(getPool()));
  return router({
    photoCapability: protectedProcedure.input(z.object({ tenantId }).strict()).query(async ({ ctx, input }) => {
      try {
        const db = getPool();
        await authorizeWorkspace(db, ctx.user.id, input.tenantId);
        // Schema and local storage alone do not prove the public photo routes
        // and retention owner have been commissioned on the deployed service.
        return { available: profilePhotoCommissioned()
          && await profilePhotosAvailable(db) && await profilePhotoStorageReady(),
          maxBytes: MAX_PROFILE_PHOTO_BYTES, mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        return { available: false, maxBytes: MAX_PROFILE_PHOTO_BYTES,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const };
      }
    }),
    self: protectedProcedure.input(z.object({ tenantId }).strict()).query(async ({ ctx, input }) => {
      try { return await currentService().self(ctx.user.id, input.tenantId); }
      catch (error) { return trpcError(error); }
    }),
    update: protectedProcedure.input(profileUpdateSchema).mutation(async ({ ctx, input }) => {
      try { return await currentService().update(ctx.user.id, input.tenantId, {
        availability: input.availability,
        status: input.status,
        workLocation: input.workLocation,
      }); }
      catch (error) { return trpcError(error); }
    }),
    colleagues: protectedProcedure.input(z.object({ tenantId, userIds: z.array(z.number().int().positive()).max(100) }).strict()).query(async ({ ctx, input }) => {
      try { return await currentService().colleagues(ctx.user.id, input.tenantId, input.userIds); }
      catch (error) { return trpcError(error); }
    }),
  });
}

export const profileRouter = createProfileRouter();
