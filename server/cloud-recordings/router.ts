import { configuredRecordingCapture } from "./capture-service";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createCloudRecordingRepository } from "./repository";
const tenantId=z.number().int().positive();
const callUuid=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
// Construct lazily: importing router never starts a DB connection or migration.
const repo=()=>createCloudRecordingRepository();
export const cloudRecordingsRouter=router({
 startCapture:protectedProcedure.input(z.object({callUuid:z.string().uuid()})).mutation(async({ctx,input})=>({started:await configuredRecordingCapture()?.manualStart(input.callUuid,ctx.user.id)??false})),
 stopCapture:protectedProcedure.input(z.object({callUuid:z.string().uuid()})).mutation(async({ctx,input})=>({stopped:await configuredRecordingCapture()?.manualStop(input.callUuid,ctx.user.id)??false})),
 list:protectedProcedure.input(z.object({tenantId:tenantId.optional(),limit:z.number().int().min(1).max(100).optional()}).optional()).query(({ctx,input})=>repo().list(ctx.user.id,input)),
 detail:protectedProcedure.input(z.object({callUuid})).query(async({ctx,input})=>{
  const detail=await repo().detail(ctx.user.id,input.callUuid);
  let manualControls={canStart:false,canStop:false};
  try { manualControls=await configuredRecordingCapture()?.capabilities(input.callUuid,ctx.user.id)??manualControls; }
  catch { /* Unknown runtime capability never enables an action. */ }
  return {...detail,manualControls};
 }),
 getPolicy:protectedProcedure.input(z.object({tenantId})).query(({ctx,input})=>repo().getPolicy(ctx.user.id,input.tenantId)),
 updatePolicy:protectedProcedure.input(z.object({tenantId,mode:z.enum(['off','manual','automatic']),aiEnabled:z.boolean(),retentionDays:z.number().int().min(1).max(365)})).mutation(({ctx,input})=>repo().updatePolicy(ctx.user.id,input)),
});
