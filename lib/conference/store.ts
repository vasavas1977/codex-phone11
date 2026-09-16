import { create } from 'zustand';
import type { Conference, ConferenceConfig, ConferenceAction } from './types';
import { conferenceEngine } from './engine';
interface ConferenceStore {
 activeConference:Conference|null; history:Conference[]; isLoading:boolean; error:string|null;
 init:()=>Promise<void>;
 createConference:(name:string,config?:Partial<ConferenceConfig>)=>Promise<Conference>;
 /** Refresh an authorized room. This does not establish a native media session. */
 joinConference:(conferenceId:string)=>Promise<void>;
 leaveConference:()=>Promise<void>;
 addParticipant:(extension:string,name:string)=>Promise<void>;
 executeAction:(action:ConferenceAction)=>Promise<void>;
 toggleRecording:()=>Promise<void>;
 updateAudioLevel:(participantId:string,level:number)=>void;
 updateSpeaking:(participantId:string,isSpeaking:boolean)=>void;
 loadHistory:()=>Promise<void>;
}
export const useConferenceStore=create<ConferenceStore>((set,get)=>{
 async function run<T>(operation:()=>Promise<T>):Promise<T>{
  set({isLoading:true,error:null});
  try{return await operation();}catch(error){set({error:error instanceof Error?error.message:'Conference unavailable'});throw error;}finally{set({isLoading:false});}
 }
 function apply(snapshot:Conference){set(state=>({activeConference:snapshot.state==='ended'?null:snapshot,history:[snapshot,...state.history.filter(c=>c.id!==snapshot.id)]}));}
 return {
  activeConference:null,history:[],isLoading:false,error:null,
  init:()=>run(async()=>{await conferenceEngine.init();const capability=await conferenceEngine.getCapabilities();if(!capability.audioAvailable){set({activeConference:null,history:[],error:capability.reason});return;}set({history:await conferenceEngine.getConferenceHistory()});}),
  createConference:(name,config)=>run(async()=>{const snapshot=await conferenceEngine.createConference(name,config);apply(snapshot);return snapshot;}),
  joinConference:id=>run(async()=>{apply(await conferenceEngine.getConference(id));}),
  // Viewing another room must not silently disconnect everybody. Only explicit
  // moderator controls use the server's end endpoint.
  leaveConference:async()=>{set({activeConference:null});},
  addParticipant:(extension,name)=>run(async()=>{const room=get().activeConference;if(room)apply(await conferenceEngine.addParticipant(room.id,extension,name));}),
  executeAction:action=>run(async()=>{const room=get().activeConference;if(room)apply(await conferenceEngine.executeAction(room.id,action));}),
  toggleRecording:async()=>{const room=get().activeConference;if(room)await get().executeAction({type:room.isRecording?'stop_recording':'start_recording'});},
  // Speaking and levels are supplied only by verified provider observations.
  updateAudioLevel:()=>{},updateSpeaking:()=>{},
  loadHistory:()=>run(async()=>{set({history:await conferenceEngine.getConferenceHistory()});}),
 };
});
