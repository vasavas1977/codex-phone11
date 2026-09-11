import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({enabled:false,owner:{id:2} as {id:number}|null,active:'active',tenantId:10,
 effect:null as null|(()=>void|(()=>void)),listeners:{auth:0,chat:0,activity:0,token:0,response:0},
 callbacks:{} as Record<string,Set<(...args:any[])=>void>>,permission:vi.fn(async(_explicit:boolean)=>false),
 token:vi.fn(async()=>'a'.repeat(64)),register:vi.fn(async(_token:string,_tenant:number,_current:()=>boolean)=>true)}));
function listen(key:keyof typeof f.listeners,callback:(...args:any[])=>void){f.listeners[key]++;(f.callbacks[key]??=new Set()).add(callback);return ()=>{f.listeners[key]--;f.callbacks[key].delete(callback);};}
function emit(key:string,value?:unknown){f.callbacks[key]?.forEach(fn=>fn(value));}
vi.mock('react',()=>({useEffect:(run:()=>void|(()=>void))=>{f.effect=run;}}));
vi.mock('react-native',()=>({AppState:{get currentState(){return f.active;},addEventListener:(_name:string,fn:()=>void)=>({remove:listen('activity',fn)})},Alert:{alert:vi.fn()}}));
vi.mock('expo-router',()=>({router:{push:vi.fn()}}));
vi.mock('expo-notifications',()=>({addPushTokenListener:(fn:()=>void)=>({remove:listen('token',fn)}),addNotificationResponseReceivedListener:(fn:()=>void)=>({remove:listen('response',fn)}),getLastNotificationResponseAsync:async()=>null,clearLastNotificationResponseAsync:async()=>{},dismissAllNotificationsAsync:async()=>{}}));
vi.mock('../lib/_core/auth',()=>({getAuthSnapshot:()=>({user:f.owner,loading:false}),addAuthChangeListener:(fn:()=>void)=>listen('auth',fn)}));
vi.mock('../lib/chat/store',()=>({useChatStore:{getState:()=>({workspace:{id:f.tenantId}}),subscribe:(fn:()=>void)=>listen('chat',fn)}}));
vi.mock('../lib/notifications/client',()=>({chatNotificationClientEnabled:()=>f.enabled,chatNotificationPermission:f.permission,ordinaryApnsToken:f.token,
 parseOrdinaryApnsToken:(v:any)=>v?.type==='ios'&&typeof v.data==='string'&&/^[0-9a-fA-F]{32,512}$/.test(v.data)?v.data.toLowerCase():null,
 registerChatNotificationToken:f.register,resolveChatNotification:vi.fn(async()=>null)}));
import {ChatNotifications,enableChatNotifications} from '../lib/notifications/chat-notifications';
import {ChatNotificationSetupError} from '../lib/notifications/coordinator';
const cleanups:(()=>void)[]=[];
function mount(){ChatNotifications();const off=f.effect!();if(typeof off==='function')cleanups.push(off);return off;}
beforeEach(()=>{vi.useFakeTimers();f.enabled=false;f.owner={id:2};f.active='active';f.tenantId=10;f.effect=null;f.callbacks={};for(const k of Object.keys(f.listeners) as Array<keyof typeof f.listeners>)f.listeners[k]=0;vi.resetAllMocks();f.permission.mockResolvedValue(false);f.token.mockResolvedValue('a'.repeat(64));f.register.mockResolvedValue(true);});
afterEach(()=>{cleanups.splice(0).forEach(off=>off());vi.useRealTimers();});
it('disabled mounted component registers no observers, token request or permission work',async()=>{mount();await vi.advanceTimersByTimeAsync(0);expect(f.listeners).toEqual({auth:0,chat:0,activity:0,token:0,response:0});expect(f.permission).not.toHaveBeenCalled();expect(f.token).not.toHaveBeenCalled();expect(await enableChatNotifications()).toEqual({status:'unavailable'});});
it('mount cleanup and remount retain one observer of each type',async()=>{f.enabled=true;mount();expect(f.listeners).toEqual({auth:1,chat:1,activity:1,token:1,response:1});await vi.advanceTimersByTimeAsync(0);cleanups.pop()!();expect(f.listeners).toEqual({auth:0,chat:0,activity:0,token:0,response:0});expect(await enableChatNotifications()).toEqual({status:'unavailable'});mount();expect(f.listeners).toEqual({auth:1,chat:1,activity:1,token:1,response:1});expect(await enableChatNotifications()).toEqual({status:'permission-denied'});expect(f.token).not.toHaveBeenCalled();});
it('synchronous native token re-emission does not loop or invalidate explicit enable',async()=>{
 f.enabled=true;mount();await vi.advanceTimersByTimeAsync(0);f.permission.mockResolvedValue(true);
 f.token.mockImplementation(async()=>{emit('token',{type:'ios',data:'A'.repeat(64)});return 'a'.repeat(64);});
 expect(await enableChatNotifications()).toEqual({status:'enabled'});expect(f.token).toHaveBeenCalledOnce();expect(f.register).toHaveBeenCalledOnce();
 emit('token',{type:'ios',data:'a'.repeat(64)});emit('token',{type:'android',data:'b'.repeat(64)});emit('token',{type:'ios',data:'invalid'});await vi.advanceTimersByTimeAsync(120000);
 expect(f.token).toHaveBeenCalledOnce();expect(f.register).toHaveBeenCalledOnce();
 emit('token',{type:'ios',data:'b'.repeat(64)});await vi.advanceTimersByTimeAsync(0);expect(f.token).toHaveBeenCalledOnce();expect(f.register).toHaveBeenCalledTimes(2);expect(f.register.mock.calls[1][0]).toBe('b'.repeat(64));
});
it('transient server recovery reuses observed token without another native lookup or permission prompt',async()=>{
 f.enabled=true;f.permission.mockResolvedValue(true);f.register.mockRejectedValueOnce(new Error('offline'));mount();await vi.advanceTimersByTimeAsync(0);
 expect(f.register).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(5000);expect(f.register).toHaveBeenCalledTimes(2);expect(f.token).toHaveBeenCalledOnce();expect(f.permission.mock.calls.every(c=>c[0]===false)).toBe(true);
});
it('background and unmount stop recovery; a new owner cannot use an old registration guard',async()=>{
 f.enabled=true;f.permission.mockResolvedValue(true);let finish!:(v:boolean)=>void;
 f.register.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));mount();await vi.advanceTimersByTimeAsync(0);const oldGuard=f.register.mock.calls[0][2];
 f.owner={id:3};emit('auth');await vi.advanceTimersByTimeAsync(0);expect(oldGuard()).toBe(false);finish(true);await vi.advanceTimersByTimeAsync(0);
 f.register.mockRejectedValue(new Error('offline'));emit('token',{type:'ios',data:'b'.repeat(64)});await vi.advanceTimersByTimeAsync(0);const count=f.register.mock.calls.length;
 f.active='background';emit('activity');await vi.advanceTimersByTimeAsync(120000);expect(f.register).toHaveBeenCalledTimes(count);
 f.active='active';emit('activity');await vi.advanceTimersByTimeAsync(0);expect(f.register).toHaveBeenCalledTimes(count+1);
 cleanups.pop()!();await vi.advanceTimersByTimeAsync(120000);expect(f.register).toHaveBeenCalledTimes(count+1);
});
it('a rejected native token lookup is not retried, but a later valid token event can recover',async()=>{
 f.enabled=true;f.permission.mockResolvedValue(true);f.token.mockRejectedValue(new ChatNotificationSetupError(false));mount();await vi.advanceTimersByTimeAsync(120000);
 expect(f.token).toHaveBeenCalledOnce();expect(f.register).not.toHaveBeenCalled();emit('token',{type:'ios',data:'c'.repeat(64)});await vi.advanceTimersByTimeAsync(0);
 expect(f.token).toHaveBeenCalledOnce();expect(f.register).toHaveBeenCalledOnce();expect(f.register.mock.calls[0][0]).toBe('c'.repeat(64));
});
