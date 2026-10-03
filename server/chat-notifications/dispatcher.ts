import { chatNotificationRepository, chatNotificationsEnabled } from './repository';
import { sendApnsAlert, PushProviderError } from '../push/apns';
import { clearTimeout, setTimeout } from 'node:timers';
type ChatNotificationDispatcherRepository=Pick<typeof chatNotificationRepository,'claim'|'current'|'finish'|'removeInvalid'|'prune'>;
export function createChatNotificationDispatcher(repository:ChatNotificationDispatcherRepository=chatNotificationRepository,send=sendApnsAlert,enabled=chatNotificationsEnabled) {
 return async function dispatchOne() {
  if(!enabled())return false;
  const item=await repository.claim();if(!item)return false;
  let accepted=false;
  try {
   if(!enabled()||!await repository.current(item))return true;
   await send({platform:'ios',tokenType:'apns',token:item.token,bundleId:item.bundleId,sandbox:item.environment==='sandbox'},
    {eventId:item.id,expiresAt:item.expiresAt},async()=>enabled()&&await repository.current(item));
   accepted=true;
  } catch(error) {
   if(error instanceof PushProviderError && error.invalidToken && (error.invalidatedAt===undefined||item.registeredAt<=error.invalidatedAt)) {
    try {await repository.removeInvalid(item,error.invalidatedAt);}catch{/* no unsafe replacement cleanup */}
   }
  } finally {await repository.finish(item,accepted);}
  return true;
 };
}
/** At-most-one provider attempt per outbox row. Missing migrations/providers
 * fail without changing committed chat messages or replaying uncertain pushes. */
export function startChatNotificationDispatcher(options:{
 repository?:ChatNotificationDispatcherRepository;
 send?:typeof sendApnsAlert;
 enabled?:()=>boolean;
 initialDelayMs?:number;
 intervalMs?:number;
}={}) {
 const repository=options.repository??chatNotificationRepository;
 const enabled=options.enabled??chatNotificationsEnabled;
 if(!enabled())return async()=>{};
 let stopped=false,timer:NodeJS.Timeout|undefined,activeTick:Promise<void>|undefined,stopPromise:Promise<void>|undefined;
 const dispatch=createChatNotificationDispatcher(repository,options.send??sendApnsAlert,enabled);
 const tick=async()=>{
  if(stopped||activeTick)return;
  const current=(async()=>{
  try {for(let i=0;i<10&&!stopped&&enabled();i++)if(!await dispatch())break;
   if(!stopped)await repository.prune();
  }catch{/* bounded worker failure; no raw token/provider/DB logging */}
  finally {if(!stopped){timer=setTimeout(()=>void tick(),options.intervalMs??5000) as unknown as NodeJS.Timeout;timer.unref();}}
  })();
  activeTick=current;
  await current;
  if(activeTick===current)activeTick=undefined;
 };
 timer=setTimeout(()=>void tick(),options.initialDelayMs??1000) as unknown as NodeJS.Timeout;timer.unref();
 return ()=>{
  if(stopPromise)return stopPromise;
  stopped=true;if(timer)clearTimeout(timer);
  stopPromise=activeTick??Promise.resolve();
  return stopPromise;
 };
}
