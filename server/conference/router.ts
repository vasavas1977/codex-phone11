import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';
import { getPool } from '../pbx/db';
import { getFreeSwitchConfig } from '../pbx/fs-config';
import { createConferenceService, unavailableCapabilities } from './service';
import { createConferenceRepository } from './repository';
import { createProvisionedConferenceProvider } from './provider';
import { createConferenceEsl } from './esl';
const id=z.string().uuid();
const key=z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
const participant=z.string().regex(/^[1-9][0-9]*$/);
const action=z.discriminatedUnion('type',[
 z.object({type:z.literal('mute_participant'),participantId:participant}),z.object({type:z.literal('unmute_participant'),participantId:participant}),z.object({type:z.literal('kick_participant'),participantId:participant}),
 ...(['mute_all','unmute_all','start_recording','stop_recording','lock_conference','unlock_conference'] as const).map(type=>z.object({type:z.literal(type)})),
 z.object({type:z.literal('promote_to_moderator'),participantId:participant}),z.object({type:z.literal('demote_to_listener'),participantId:participant}),
]);
function service(){
 const db=getPool();
 const provider=process.env.PHONE11_CONFERENCE_CONTROLS_ENABLED==='true'?createProvisionedConferenceProvider(db,createConferenceEsl(getFreeSwitchConfig())):undefined;
 return createConferenceService(createConferenceRepository(db),provider);
}
async function safe<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(e){if(e instanceof TRPCError)throw e;throw new TRPCError({code:'PRECONDITION_FAILED',message:'Conference service is unavailable'});}}
export const conferenceRouter=router({
 capabilities:protectedProcedure.query(async({ctx})=>{try{return await service().capabilities(ctx.user.id);}catch{return unavailableCapabilities;}}),
 list:protectedProcedure.query(({ctx})=>safe(()=>service().list(ctx.user.id))),
 detail:protectedProcedure.input(z.object({conferenceId:id})).query(({ctx,input})=>safe(()=>service().detail(ctx.user.id,input.conferenceId))),
 create:protectedProcedure.input(z.object({name:z.string().trim().min(1).max(100),config:z.object({maxParticipants:z.number().int().min(2).max(100),pin:z.string().optional(),moderatorPin:z.string().optional(),recordEnabled:z.boolean(),muteOnEntry:z.boolean(),announceJoinLeave:z.boolean(),waitForModerator:z.boolean(),endWhenModeratorLeaves:z.boolean()}).partial().optional(),idempotencyKey:key})).mutation(({ctx,input})=>safe(()=>service().execute(ctx.user.id,input.idempotencyKey,{type:'create',name:input.name,config:input.config}))),
 addParticipant:protectedProcedure.input(z.object({conferenceId:id,extension:z.string().regex(/^[0-9]{2,16}$/),name:z.string().max(100),idempotencyKey:key})).mutation(({ctx,input})=>safe(()=>service().execute(ctx.user.id,input.idempotencyKey,{type:'addParticipant',conferenceId:input.conferenceId,extension:input.extension,name:input.name}))),
 action:protectedProcedure.input(z.object({conferenceId:id,action,idempotencyKey:key})).mutation(({ctx,input})=>safe(()=>service().execute(ctx.user.id,input.idempotencyKey,{type:'action',conferenceId:input.conferenceId,action:input.action}))),
 end:protectedProcedure.input(z.object({conferenceId:id,idempotencyKey:key})).mutation(({ctx,input})=>safe(()=>service().execute(ctx.user.id,input.idempotencyKey,{type:'end',conferenceId:input.conferenceId}))),
});
