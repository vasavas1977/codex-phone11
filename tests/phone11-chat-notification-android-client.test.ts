import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({platform:'android',extra:{} as Record<string,unknown>,permission:{granted:false},order:[] as string[],request:vi.fn(async()=>({granted:true})),native:vi.fn(async()=>({type:'android',data:'CaseSensitive_FCM:Token-'.repeat(4)}))}));
vi.mock('react-native',()=>({Platform:{get OS(){return f.platform;}}}));
vi.mock('expo-constants',()=>({default:{expoConfig:{get extra(){return f.extra;},android:{package:'ai.phone11.mobile.androidcandidate'},ios:{bundleIdentifier:'ai.phone11.mobile'}}}}));
vi.mock('expo-notifications',()=>({AndroidImportance:{DEFAULT:3},setNotificationChannelAsync:vi.fn(async()=>{f.order.push('channel');}),getPermissionsAsync:vi.fn(async()=>{f.order.push('permission');return f.permission;}),requestPermissionsAsync:f.request,getDevicePushTokenAsync:f.native}));
vi.mock('expo-secure-store',()=>({}));
vi.mock('../lib/_core/auth',()=>({getAuthSnapshot:()=>({user:null}),getSessionToken:vi.fn()}));
vi.mock('../constants/oauth',()=>({getApiBaseUrl:()=>''}));
import * as Notifications from 'expo-notifications';
import {chatNotificationClientEnabled,chatNotificationPermission,ordinaryChatToken,parseOrdinaryChatToken,parseOrdinaryApnsToken} from '../lib/notifications/client';
beforeEach(()=>{vi.clearAllMocks();f.platform='android';f.extra={phone11AndroidChatNotificationsEnabled:true,phone11FcmProjectId:'phone11-test'};f.permission={granted:false};f.order=[];});
afterEach(()=>vi.restoreAllMocks());
it('Android remains off without its explicit flag/project and ignores the iOS flag',async()=>{
 f.extra={phone11ChatNotificationsEnabled:true,phone11ApnsEnvironment:'production'};expect(chatNotificationClientEnabled()).toBe(false);expect(await chatNotificationPermission(true)).toBe(false);expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();expect(f.native).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
});
it('creates Android channel before inspecting permission, prompting only for explicit action',async()=>{
 expect(await chatNotificationPermission(false)).toBe(false);expect(f.order).toEqual(['channel','permission']);expect(f.request).not.toHaveBeenCalled();
 expect(await chatNotificationPermission(true)).toBe(true);expect(f.request).toHaveBeenCalledWith({});expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('phone11_team_chat',expect.objectContaining({importance:3}));
});
it('native FCM tokens and token events preserve case and reject APNs/Expo/wrong-shaped tokens',async()=>{
 const token='CaseSensitive_FCM:Token-'.repeat(4);expect(await ordinaryChatToken()).toBe(token);expect(parseOrdinaryChatToken({type:'android',data:token})).toBe(token);
 for(const bad of [{type:'ios',data:'a'.repeat(64)},{type:'expo',data:token},{type:'android',data:'ExpoPushToken[bad]'},{type:'android',data:'x'.repeat(4097)},{type:'android',data:['bad']}])expect(parseOrdinaryChatToken(bad)).toBeNull();
});
it('iOS gate and APNs normalization remain unchanged',()=>{f.platform='ios';expect(chatNotificationClientEnabled()).toBe(false);f.extra={phone11ChatNotificationsEnabled:true,phone11ApnsEnvironment:'production'};expect(chatNotificationClientEnabled()).toBe(true);expect(parseOrdinaryChatToken({type:'ios',data:'A'.repeat(64)})).toBe('a'.repeat(64));expect(parseOrdinaryApnsToken({type:'android',data:'A'.repeat(64)})).toBeNull();});
