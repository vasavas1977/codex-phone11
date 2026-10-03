import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router,protectedProcedure } from '../_core/trpc';
import { resolvePushSession } from '../push/session';
import { readApnsConfig } from '../push/apns';
import { chatNotificationRepository,chatNotificationsEnabled } from './repository';
function requireEnabled() {if(!chatNotificationsEnabled())throw new TRPCError({code:'PRECONDITION_FAILED',message:'Chat notifications are not configured.'});}
export const chatNotificationsRouter=router({
 readiness:protectedProcedure.query(()=>{if(!chatNotificationsEnabled())return {available:false};try{readApnsConfig();return {available:true};}catch{return {available:false};}}),
 register:protectedProcedure.input(z.object({tenantId:z.number().int().positive(),deviceId:z.string().uuid(),token:z.string().regex(/^[0-9a-fA-F]{32,512}$/),bundleId:z.string().max(512),environment:z.enum(['sandbox','production'])})).mutation(async({ctx,input})=>{
  requireEnabled();const config=readApnsConfig();
  if(config.bundleId!==input.bundleId||config.environment!==input.environment)throw new TRPCError({code:'BAD_REQUEST',message:'Notification app configuration does not match.'});
  const session=await resolvePushSession(ctx.req.headers,ctx.user.id);
  return chatNotificationRepository.register(ctx.user.id,session,input);
 }),
 unregister:protectedProcedure.input(z.object({deviceId:z.string().uuid()})).mutation(async({ctx,input})=>{
  const session=await resolvePushSession(ctx.req.headers,ctx.user.id);await chatNotificationRepository.unregister(ctx.user.id,session,input.deviceId);return {removed:true};
 }),
 resolve:protectedProcedure.input(z.object({eventId:z.string().uuid()})).query(async({ctx,input})=>{
  requireEnabled();const session=await resolvePushSession(ctx.req.headers,ctx.user.id);
  return chatNotificationRepository.resolve(ctx.user.id,session,input.eventId);
 }),
});
