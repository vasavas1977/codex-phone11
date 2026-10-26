import { sendFcmMessage,type FcmDevice } from '../push/fcm';
import { PushProviderError,type ChatAlertPayload } from '../push/apns';
import { androidChatNotificationsEnabled } from './repository';
/** Generic lock-screen content only. The opaque event is resolved with current
 * account/workspace authority after a tap; no sender/message/route is sent. */
export function createFcmChatSender(send=sendFcmMessage,enabled=androidChatNotificationsEnabled,now=()=>Date.now()) {
 return async(device:FcmDevice,payload:ChatAlertPayload,beforeAttempt?:()=>Promise<boolean>)=>{
  if(!enabled())throw new PushProviderError('configuration');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.eventId??''))throw new PushProviderError('rejected');
  const remaining=payload.expiresAt-now();
  if(!Number.isFinite(remaining)||remaining<=0||remaining>600_000)throw new PushProviderError('rejected');
  await send(device,{notification:{title:'Phone11',body:'New message'},data:{type:'phone11_chat',eventId:payload.eventId},
   android:{priority:'HIGH',ttl:`${Math.floor(remaining/1000)}s`,restricted_package_name:device.bundleId,
    notification:{channel_id:'phone11_team_chat',sound:'default'}}},async()=>enabled()&&payload.expiresAt>now()&&(!beforeAttempt||await beforeAttempt()),payload.expiresAt,payload.expiresAt);
 };
}
export const sendFcmChatAlert=createFcmChatSender();
