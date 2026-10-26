import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router,protectedProcedure } from '../_core/trpc';
import { resolvePushSession } from '../push/session';
import { readApnsConfig } from '../push/apns';
import { readFcmConfig } from '../push/fcm';
import { chatNotificationRepository,chatNotificationsEnabled,androidChatNotificationsEnabled } from './repository';
function requireEnabled(platform:'ios'|'android'='ios') {if(!chatNotificationsEnabled()||(platform==='android'&&!androidChatNotificationsEnabled()))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Chat notifications are not configured.'});}
const common={tenantId:z.number().int().positive(),deviceId:z.string().uuid(),bundleId:z.string().max(512)};
const registration=z.union([
 z.object({...common,platform:z.literal('ios').optional(),token:z.string().regex(/^[0-9a-fA-F]{32,512}$/),environment:z.enum(['sandbox','production'])}),
 z.object({...common,platform:z.literal('android'),projectId:z.string().max(128),token:z.string().regex(/^[A-Za-z0-9_:-]{32,4096}$/),environment:z.literal('production')}),
]);
export const chatNotificationsRouter=router({
 readiness:protectedProcedure.input(z.object({platform:z.enum(['ios','android'])}).optional()).query(({input})=>{
  const platform=input?.platform??'ios';
  if(!chatNotificationsEnabled()||(platform==='android'&&!androidChatNotificationsEnabled()))return {available:false};
  try{if(platform==='android')readFcmConfig();else readApnsConfig();return {available:true};}catch{return {available:false};}
 }),
 register:protectedProcedure.input(registration).mutation(async({ctx,input})=>{
  const platform=input.platform??'ios';requireEnabled(platform);
  if(input.platform==='android'){
   const config=readFcmConfig();
   if(config.packageName!==input.bundleId||config.projectId!==input.projectId)throw new TRPCError({code:'BAD_REQUEST',message:'Notification app configuration does not match.'});
  }else{
   const config=readApnsConfig();
   if(config.bundleId!==input.bundleId||config.environment!==input.environment)throw new TRPCError({code:'BAD_REQUEST',message:'Notification app configuration does not match.'});
  }
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
