import { TRPCError } from '@trpc/server';
import type { Conference, ConferenceAction, ConferenceConfig } from '../../lib/conference/types';

export interface ConferenceScope { userId: number; tenantId: number }
export interface ConferenceCapabilities { audioAvailable: boolean; createAvailable: false; inviteAvailable: false; joinAvailable: false; videoAvailable: false; reason: string }
export type ConferenceOperation =
 | { type: 'create'; name: string; config?: Partial<ConferenceConfig> }
 | { type: 'addParticipant'; conferenceId: string; extension: string; name: string }
 | { type: 'action'; conferenceId: string; action: ConferenceAction }
 | { type: 'end'; conferenceId: string };
/** Implementations must persist claims before external effects. An ambiguous claim is
 * never replayed automatically; reconciliation must establish the provider outcome. */
export interface ConferenceRepository {
 scope(userId: number): Promise<ConferenceScope>;
 assertRoom(scope: ConferenceScope, conferenceId: string, moderate: boolean): Promise<void>;
 once(scope: ConferenceScope, key: string, operation: ConferenceOperation, run: () => Promise<Conference>): Promise<Conference>;
}
/** Trusted server adapter only. DTOs must come from provider observations, not dial ACKs.
 * The adapter owns tenant-isolated room provisioning, destinations and member mapping. */
export interface ConferenceProvider {
 available(scope: ConferenceScope): Promise<boolean>;
 list(scope: ConferenceScope): Promise<Conference[]>;
 detail(scope: ConferenceScope, id: string): Promise<Conference>;
 execute(scope: ConferenceScope, operation: ConferenceOperation): Promise<Conference>;
}
export const unavailableCapabilities: ConferenceCapabilities = {
 audioAvailable: false, createAvailable: false, inviteAvailable: false, joinAvailable: false, videoAvailable: false,
 reason: 'Conference service is not provisioned for this workspace. Audio room provisioning and verified participant events are required; video media is not configured.',
};
const unavailable = () => new TRPCError({ code: 'PRECONDITION_FAILED', message: unavailableCapabilities.reason });
export function createConferenceService(repository: ConferenceRepository, provider?: ConferenceProvider) {
 async function scope(userId: number) { return repository.scope(userId); }
 return {
  async capabilities(userId: number): Promise<ConferenceCapabilities> {
   if (!provider) return unavailableCapabilities;
   const actor = await scope(userId);
   if (!await provider.available(actor)) return unavailableCapabilities;
   return { audioAvailable: true, createAvailable: false, inviteAvailable: false, joinAvailable: false, videoAvailable: false, reason: 'Video conference media is not configured.' };
  },
  async list(userId: number) {
   if (!provider) throw unavailable();
   return provider.list(await scope(userId));
  },
  async detail(userId: number, id: string) {
   if (!provider) throw unavailable();
   const actor = await scope(userId); await repository.assertRoom(actor, id, false);
   return provider.detail(actor, id);
  },
  async execute(userId: number, key: string, operation: ConferenceOperation) {
   if (!provider) throw unavailable();
   if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new TRPCError({code:'BAD_REQUEST',message:'An idempotency key is required'});
   const actor = await scope(userId);
   if (operation.type==='create' || operation.type==='addParticipant') throw unavailable();
   if ('conferenceId' in operation) await repository.assertRoom(actor, operation.conferenceId, true);
   if (operation.type === 'action' && ['start_recording','stop_recording','promote_to_moderator','demote_to_listener'].includes(operation.action.type))
    throw new TRPCError({code:'PRECONDITION_FAILED',message:'This conference control is not configured'});
   return repository.once(actor, key, operation, () => provider.execute(actor, operation));
  },
 };
}
