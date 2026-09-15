import { useEffect } from 'react';
import { AppState, Alert } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { addAuthChangeListener,getAuthSnapshot } from '../_core/auth';
import { useChatStore } from '../chat/store';
import { createChatNotificationCoordinator, type ChatNotificationEnableResult } from './coordinator';
import { createEnrollmentRecovery } from './enrollment-recovery';
import { chatNotificationClientEnabled,chatNotificationPermission,ordinaryApnsToken,parseOrdinaryApnsToken,registerChatNotificationToken,resolveChatNotification } from './client';
let enable:()=>Promise<ChatNotificationEnableResult>=async()=>({status:"unavailable"});
/** Invoke from an explicit notification-permission action, never on launch. */
export const enableChatNotifications=()=>enable();
export function ChatNotifications() {
 useEffect(()=>{
  // Default-off means no native token request, listener, prompt or enrollment.
  if(!chatNotificationClientEnabled())return;
  const identity=()=>({owner:getAuthSnapshot().user,tenantId:useChatStore.getState().workspace?.id??null,
   active:AppState.currentState==='active',enabled:chatNotificationClientEnabled()&&!getAuthSnapshot().loading});
  let observedToken:string|null=null,lookup:Promise<string>|null=null,stopped=false;
  const currentToken=()=>{
   if(observedToken)return Promise.resolve(observedToken);
   if(!lookup)lookup=Promise.resolve().then(ordinaryApnsToken).then(value=>{
    if(!stopped)observedToken=observedToken??value;
    return observedToken??value;
   }).finally(()=>{lookup=null;});
   return lookup;
  };
  const coordinator=createChatNotificationCoordinator({identity,permission:chatNotificationPermission,token:currentToken,
   register:registerChatNotificationToken,resolve:resolveChatNotification,open:destination=>{
    router.push({pathname:'/chat/[id]',params:{id:destination.conversationId,tenantId:String(destination.tenantId)}});
   },unavailable:()=>Alert.alert('Message unavailable','Open Team Chat to see your current conversations.')});
  let last=identity();
  const recovery=createEnrollmentRecovery({identity,refresh:explicit=>coordinator.refresh(explicit)});
  const refresh=()=>void recovery.refresh().catch(()=>{});
  const sync=()=>{
   const next=identity();if(next.owner!==last.owner||next.tenantId!==last.tenantId||next.active!==last.active||next.enabled!==last.enabled){
    const activityOnly=next.owner===last.owner&&next.tenantId===last.tenantId&&next.enabled===last.enabled;
    recovery.invalidate();
    coordinator.invalidate(last.owner!==null&&next.owner!==last.owner,activityOnly);
    if(next.owner!==last.owner){observedToken=null;void Notifications.dismissAllNotificationsAsync().catch(()=>{});}
    last=next;refresh();void coordinator.resumeTap();
   }
  };
  const offAuth=addAuthChangeListener(sync),offChat=useChatStore.subscribe(sync);
  const activity=AppState.addEventListener('change',sync);
  const token=Notifications.addPushTokenListener(value=>{
   const next=parseOrdinaryApnsToken(value);
   if(stopped||!next||next===observedToken)return;
   observedToken=next;
   // Expo emits this event during getDevicePushTokenAsync. Consume the value,
   // never call the getter from its listener or restart its pending lookup.
   if(lookup)return;
   recovery.invalidate();coordinator.invalidate();refresh();void coordinator.resumeTap();
  });
  const response=Notifications.addNotificationResponseReceivedListener(value=>{
   void coordinator.tap(value.notification.request.content.data);
   void Notifications.clearLastNotificationResponseAsync().catch(()=>{});
  });
  void Notifications.getLastNotificationResponseAsync().then(value=>{if(value){void coordinator.tap(value.notification.request.content.data);void Notifications.clearLastNotificationResponseAsync().catch(()=>{});}}).catch(()=>{});
  const request=()=>recovery.refresh(true);enable=request;refresh();
  return ()=>{stopped=true;observedToken=null;recovery.stop();coordinator.stop();offAuth();offChat();activity.remove();token.remove();response.remove();if(enable===request)enable=async()=>({status:"unavailable"});};
 },[]);
 return null;
}
