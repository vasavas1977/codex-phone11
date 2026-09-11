import {beforeEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({enabled:false,effect:null as null|(()=>void|(()=>void)),listeners:{auth:0,chat:0,activity:0,token:0,response:0},permission:vi.fn(async()=>false),token:vi.fn(async()=>'a'.repeat(64))}));
function listen(key:keyof typeof f.listeners){f.listeners[key]++;return ()=>{f.listeners[key]--;};}
vi.mock('react',()=>({useEffect:(run:()=>void|(()=>void))=>{f.effect=run;}}));
vi.mock('react-native',()=>({AppState:{currentState:'active',addEventListener:()=>({remove:listen('activity')})},Alert:{alert:vi.fn()}}));
vi.mock('expo-router',()=>({router:{push:vi.fn()}}));
vi.mock('expo-notifications',()=>({addPushTokenListener:()=>({remove:listen('token')}),addNotificationResponseReceivedListener:()=>({remove:listen('response')}),getLastNotificationResponseAsync:async()=>null,clearLastNotificationResponseAsync:vi.fn(async()=>{}),dismissAllNotificationsAsync:vi.fn(async()=>{})}));
const owner={id:2};
vi.mock('../lib/_core/auth',()=>({getAuthSnapshot:()=>({user:owner,loading:false}),addAuthChangeListener:()=>listen('auth')}));
vi.mock('../lib/chat/store',()=>({useChatStore:{getState:()=>({workspace:{id:10}}),subscribe:()=>listen('chat')}}));
vi.mock('../lib/notifications/client',()=>({chatNotificationClientEnabled:()=>f.enabled,chatNotificationPermission:f.permission,ordinaryApnsToken:f.token,registerChatNotificationToken:vi.fn(async()=>true),resolveChatNotification:vi.fn(async()=>null)}));
import {ChatNotifications,enableChatNotifications} from '../lib/notifications/chat-notifications';
beforeEach(()=>{f.enabled=false;f.effect=null;for(const k of Object.keys(f.listeners) as Array<keyof typeof f.listeners>)f.listeners[k]=0;vi.clearAllMocks();});
it('disabled mounted component registers no observers, token request or permission work',async()=>{ChatNotifications();const cleanup=f.effect!();await Promise.resolve();expect(f.listeners).toEqual({auth:0,chat:0,activity:0,token:0,response:0});expect(f.permission).not.toHaveBeenCalled();expect(f.token).not.toHaveBeenCalled();expect(await enableChatNotifications()).toEqual({status:'unavailable'});if(typeof cleanup==='function')cleanup();});
it('mount cleanup and remount retain one observer of each type and truthful disabled permission',async()=>{f.enabled=true;ChatNotifications();const off=f.effect!();expect(f.listeners).toEqual({auth:1,chat:1,activity:1,token:1,response:1});await Promise.resolve();if(typeof off==='function')off();expect(f.listeners).toEqual({auth:0,chat:0,activity:0,token:0,response:0});expect(await enableChatNotifications()).toEqual({status:'unavailable'});ChatNotifications();const offAgain=f.effect!();expect(f.listeners).toEqual({auth:1,chat:1,activity:1,token:1,response:1});await Promise.resolve();expect(await enableChatNotifications()).toEqual({status:'permission-denied'});if(typeof offAgain==='function')offAgain();expect(f.token).not.toHaveBeenCalled();});
