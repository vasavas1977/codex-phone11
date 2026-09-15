import { chatNotificationRepository, chatNotificationsEnabled } from './repository';
import { sendApnsAlert, PushProviderError } from '../push/apns';
export function createChatNotificationDispatcher(repository=chatNotificationRepository,send=sendApnsAlert,enabled=chatNotificationsEnabled) {
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
export function startChatNotificationDispatcher() {
 if(!chatNotificationsEnabled())return ()=>{};
 let stopped=false,busy=false,timer:ReturnType<typeof setTimeout>;
 const dispatch=createChatNotificationDispatcher();
 const tick=async()=>{
  if(stopped||busy)return;busy=true;
  try {for(let i=0;i<10&&!stopped&&chatNotificationsEnabled();i++)if(!await dispatch())break;
   await chatNotificationRepository.prune();
  }catch{/* bounded worker failure; no raw token/provider/DB logging */}
  finally {busy=false;if(!stopped){timer=setTimeout(tick,5000);timer.unref();}}
 };
 timer=setTimeout(tick,1000);timer.unref();
 return ()=>{stopped=true;clearTimeout(timer);};
}
