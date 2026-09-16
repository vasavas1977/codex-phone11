import { protectedProcedure, router } from "../_core/trpc";
import { getPool } from "../pbx/db";
import { createMeetingRepository } from "./repository";
import { createMeetingService, joinMeetingSchema, unavailableMeetingCapabilities } from "./service";
// Deliberately no environment switch: isolated credentials/alternate token routes
// and admission lifecycle must be reviewed before wiring a provider here.
export const meetingsRouter = router({
  capabilities: protectedProcedure.query(() => unavailableMeetingCapabilities),
  join: protectedProcedure.input(joinMeetingSchema).mutation(({ ctx, input }) =>
    createMeetingService({ authorize: (userId, meetingId) =>
      createMeetingRepository(getPool()).authorize(userId, meetingId) }).join(ctx.user.id, input)),
});
