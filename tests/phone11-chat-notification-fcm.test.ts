import {it,expect,vi} from 'vitest';
import {createFcmChatSender} from '../server/chat-notifications/fcm';
import {createChatNotificationDispatcher} from '../server/chat-notifications/dispatcher';
import {PushProviderError} from '../server/push/apns';
const device={platform:'android' as const,tokenType:'fcm' as const,token:'CaseSensitive_FCM:Token-'.repeat(4),bundleId:'test.phone11',sandbox:false};
const payload={eventId:'00000000-0000-4000-8000-000000000001',expiresAt:1_600_000};
it('FCM chat sends only generic alert and opaque event on its Android channel',async()=>{
 const send=vi.fn(async()=>{});await createFcmChatSender(send,()=>true,()=>1_000_000)(device,payload);
 expect(send).toHaveBeenCalledWith(device,{notification:{title:'Phone11',body:'New message'},data:{type:'phone11_chat',eventId:payload.eventId},android:{priority:'HIGH',ttl:'600s',restricted_package_name:device.bundleId,notification:{channel_id:'phone11_team_chat',sound:'default'}}},expect.any(Function),payload.expiresAt,payload.expiresAt);
});
it('FCM gate and invalid expiry fail before token/provider work',async()=>{
 const send=vi.fn();await expect(createFcmChatSender(send,()=>false,()=>1_000_000)(device,payload)).rejects.toThrow('configuration');
 for(const expiresAt of [NaN,Infinity,999_999,1_600_001])await expect(createFcmChatSender(send,()=>true,()=>1_000_000)(device,{...payload,expiresAt})).rejects.toThrow('rejected');expect(send).not.toHaveBeenCalled();
});
it('rechecks the Android gate, expiry and account/tenant authority after OAuth before send',async()=>{
 let enabled=true,now=1_000_000;const current=vi.fn(async()=>true),send=vi.fn(async(_d:any,_p:any,before?:()=>Promise<boolean>)=>{enabled=false;expect(await before!()).toBe(false);enabled=true;now=payload.expiresAt;expect(await before!()).toBe(false);now=1_000_000;current.mockResolvedValue(false);expect(await before!()).toBe(false);});
 await createFcmChatSender(send,()=>enabled,()=>now)(device,payload,current);
});
function fixture(){const item={platform:'android' as const,id:payload.eventId,revision:'revision',token:device.token,bundleId:device.bundleId,environment:'production' as const,registeredAt:1,registeredVersion:'1',expiresAt:payload.expiresAt};const repo={claim:vi.fn(async()=>item),current:vi.fn(async()=>true),finish:vi.fn(async()=>{}),removeInvalid:vi.fn(async()=>{}),prune:vi.fn(async()=>{})};return{item,repo,apns:vi.fn(async()=>{}),fcm:vi.fn(async()=>{})};}
it('Android dispatcher selects FCM and removes only a still-current invalid token revision',async()=>{const f=fixture();f.fcm.mockRejectedValue(new PushProviderError('invalid-token',404));await createChatNotificationDispatcher(f.repo,f.apns,()=>true,f.fcm)();expect(f.apns).not.toHaveBeenCalled();expect(f.fcm).toHaveBeenCalledOnce();expect(f.repo.removeInvalid).toHaveBeenCalledWith(f.item,undefined);expect(f.repo.finish).toHaveBeenCalledWith(f.item,false);});
it.each(['authentication','rejected','timeout','transport','throttled','unavailable'] as const)('FCM %s never removes or retries the token',async kind=>{const f=fixture();f.fcm.mockRejectedValue(new PushProviderError(kind));await createChatNotificationDispatcher(f.repo,f.apns,()=>true,f.fcm)();expect(f.repo.removeInvalid).not.toHaveBeenCalled();expect(f.fcm).toHaveBeenCalledOnce();expect(f.repo.finish).toHaveBeenCalledWith(f.item,false);});
it('revoked account/workspace skips Android provider entirely',async()=>{const f=fixture();f.repo.current.mockResolvedValue(false);await createChatNotificationDispatcher(f.repo,f.apns,()=>true,f.fcm)();expect(f.fcm).not.toHaveBeenCalled();});
