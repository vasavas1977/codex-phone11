import {afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({register:vi.fn(async()=>({registered:true})),resolve:vi.fn(async()=>null),unregister:vi.fn(async()=>{}),session:vi.fn(async()=>'actual-session'),config:vi.fn(()=>({bundleId:'test.phone11',environment:'production'})),fcm:vi.fn(()=>({packageName:'test.phone11',projectId:'phone11-test'}))}));
vi.mock('../server/chat-notifications/repository',()=>({chatNotificationsEnabled:()=>process.env.PHONE11_CHAT_NOTIFICATIONS_ENABLED==='1',androidChatNotificationsEnabled:()=>process.env.PHONE11_CHAT_NOTIFICATIONS_ENABLED==='1'&&process.env.PHONE11_CHAT_ANDROID_NOTIFICATIONS_ENABLED==='1',chatNotificationRepository:mocks}));
vi.mock('../server/push/session',()=>({resolvePushSession:mocks.session}));
vi.mock('../server/push/apns',()=>({readApnsConfig:mocks.config}));
vi.mock('../server/push/fcm',()=>({readFcmConfig:mocks.fcm}));
import {chatNotificationsRouter} from '../server/chat-notifications/router';
const input={tenantId:10,deviceId:'00000000-0000-4000-8000-000000000009',token:'a'.repeat(64),bundleId:'test.phone11',environment:'production' as const};
const caller=(user:any={id:2})=>chatNotificationsRouter.createCaller({user,req:{headers:{}},res:{}} as any);
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('default gate off denies enrollment before DB/session/provider work',async()=>{vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','0');expect(await caller().readiness()).toEqual({available:false});await expect(caller().register(input)).rejects.toThrow('not configured');expect(mocks.session).not.toHaveBeenCalled();expect(mocks.register).not.toHaveBeenCalled();});
it('unauthenticated callers cannot register or resolve events',async()=>{vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','1');await expect(caller(null).register(input)).rejects.toThrow();await expect(caller(null).resolve({eventId:input.deviceId})).rejects.toThrow();expect(mocks.session).not.toHaveBeenCalled();});
it('registration uses authenticated user and server-resolved session, rejecting provider mismatch first',async()=>{vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','1');await expect(caller().register({...input,bundleId:'other.app'})).rejects.toThrow('does not match');expect(mocks.session).not.toHaveBeenCalled();await caller().register(input);expect(mocks.register).toHaveBeenCalledWith(2,'actual-session',input);});

it('Android requires its separate gate before config/session work and validates package/project',async()=>{
 vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','1');vi.stubEnv('PHONE11_CHAT_ANDROID_NOTIFICATIONS_ENABLED','0');
 const android={...input,platform:'android' as const,projectId:'phone11-test',token:'CaseSensitive_FCM:Token-'.repeat(4)};
 expect(await caller().readiness({platform:'android'})).toEqual({available:false});await expect(caller().register(android)).rejects.toThrow('not configured');
 expect(mocks.fcm).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 vi.stubEnv('PHONE11_CHAT_ANDROID_NOTIFICATIONS_ENABLED','1');
 await expect(caller().register({...android,projectId:'other-project'})).rejects.toThrow('does not match');expect(mocks.session).not.toHaveBeenCalled();
 await caller().register(android);expect(mocks.register).toHaveBeenCalledWith(2,'actual-session',android);
});
it('Android tokens preserve case, reject expo tokens and never permit sandbox',async()=>{
 vi.stubEnv('PHONE11_CHAT_NOTIFICATIONS_ENABLED','1');vi.stubEnv('PHONE11_CHAT_ANDROID_NOTIFICATIONS_ENABLED','1');
 const android={...input,platform:'android' as const,projectId:'phone11-test'};
 await expect(caller().register({...android,token:'ExponentPushToken[private]'})).rejects.toThrow();
 await expect(caller().register({...android,environment:'sandbox'} as any)).rejects.toThrow();expect(mocks.register).not.toHaveBeenCalled();
});
