import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { createTRPCClient,httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../server/routers';
import { getAuthSnapshot,getSessionToken } from '../_core/auth';
import { getApiBaseUrl } from '../../constants/oauth';
const deviceKey='phone11_chat_notification_device_v1';
let devicePromise:Promise<string>|undefined;
export function chatNotificationClientEnabled() {
 return Platform.OS==='ios'&&Constants.expoConfig?.extra?.phone11ChatNotificationsEnabled===true&&
  Constants.expoConfig?.extra?.phone11ApnsEnvironment==='production';
}
async function deviceId() {
 if(!devicePromise)devicePromise=(async()=>{
  const old=await SecureStore.getItemAsync(deviceKey);if(old)return old;
  // Local grouping identifier only; never an authentication secret or access grant.
  const id="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==="x"?n:(n&3)|8).toString(16);});await SecureStore.setItemAsync(deviceKey,id,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});return id;
 })().catch(error=>{devicePromise=undefined;throw error;});
 return devicePromise;
}
async function request<T>(current:()=>boolean,run:(client:ReturnType<typeof createTRPCClient<AppRouter>>)=>Promise<T>):Promise<T> {
 const owner=getAuthSnapshot().user;
 const check=()=>{if(!owner||getAuthSnapshot().user!==owner||!current())throw new Error('Notification session changed');};
 check();const bearer=await getSessionToken();check();if(!bearer)throw new Error('Notification session unavailable');
 const client=createTRPCClient<AppRouter>({links:[httpBatchLink({url:`${getApiBaseUrl()}/api/trpc`,transformer:superjson,
  headers:{Authorization:`Bearer ${bearer}`},async fetch(url,options){check();const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),5000);
   try{return await fetch(url,{...options,credentials:'omit',signal:abort.signal});}finally{clearTimeout(timer);}
  }})]});
 const value=await run(client);check();return value;
}
export async function chatNotificationPermission(requestPermission:boolean) {
 if(!chatNotificationClientEnabled())return false;
 let permission=await Notifications.getPermissionsAsync();
 if(!permission.granted&&requestPermission)permission=await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:false,allowSound:true}});
 return permission.granted;
}
export async function ordinaryApnsToken() {
 const result=await Notifications.getDevicePushTokenAsync();
 if(result.type!=='ios'||typeof result.data!=='string'||!/^[0-9a-fA-F]{32,512}$/.test(result.data))throw new Error('Notification token unavailable');
 return result.data;
}
export async function registerChatNotificationToken(token:string,tenantId:number,current:()=>boolean) {
 if(!chatNotificationClientEnabled()||!current())return false;
 const id=await deviceId();if(!current())return false;
 const bundleId=Constants.expoConfig?.ios?.bundleIdentifier;if(!bundleId)return false;
 return request(current,async client=>{
  const readiness=await client.chatNotifications.readiness.query();if(!current()||!readiness.available)return false;
  const result=await client.chatNotifications.register.mutate({tenantId,deviceId:id,token,bundleId,environment:'production'});return result.registered===true;
 });
}
export async function resolveChatNotification(eventId:string,current:()=>boolean) {
 return request(current,client=>client.chatNotifications.resolve.query({eventId}));
}
