import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTRPCClient } from '../trpc';
import type { ConferenceConfig, ConferenceAction } from './types';
// Correlation only, never a credential. Callers can retain a key across transport retries.
const requestKey=()=>`conference_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
/** Authenticated server control plane only. No ESL credentials or synthetic rooms on-device. */
export class ConferenceEngine {
 private client() { return createTRPCClient().conference; }
 async init():Promise<void> {
  // Remove credentials and fabricated conference history left by the legacy demo.
  await AsyncStorage.multiRemove(['cloudphone11_freeswitch_esl','cloudphone11_conferences']);
 }
 getCapabilities() { return this.client().capabilities.query(); }
 getConference(id:string) { return this.client().detail.query({conferenceId:id}); }
 createConference(name:string,config:Partial<ConferenceConfig>={},idempotencyKey=requestKey()) {
  return this.client().create.mutate({name,config,idempotencyKey});
 }
 addParticipant(conferenceId:string,extension:string,name:string,idempotencyKey=requestKey()) {
  return this.client().addParticipant.mutate({conferenceId,extension,name,idempotencyKey});
 }
 executeAction(conferenceId:string,action:ConferenceAction,idempotencyKey=requestKey()) {
  return this.client().action.mutate({conferenceId,action,idempotencyKey});
 }
 endConference(conferenceId:string,idempotencyKey=requestKey()) {
  return this.client().end.mutate({conferenceId,idempotencyKey});
 }
 getConferenceHistory() { return this.client().list.query(); }
}
export const conferenceEngine=new ConferenceEngine();
