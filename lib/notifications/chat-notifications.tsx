import { useEffect } from 'react';
import { AppState, Alert } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { addAuthChangeListener,getAuthSnapshot } from '../_core/auth';
import { useChatStore } from '../chat/store';
import { createChatNotificationCoordinator, type ChatNotificationEnableResult } from './coordinator';
import { chatNotificationClientEnabled,chatNotificationPermission,ordinaryApnsToken,registerChatNotificationToken,resolveChatNotification } from './client';
let enable:()=>Promise<ChatNotificationEnableResult>=async()=>({status:"unavailable"});
/** Invoke from an explicit notification-permission action, never on launch. */
export const enableChatNotifications=()=>enable();
export function ChatNotifications() {
 useEffect(()=>{
  // Default-off means no native token request, listener, prompt or enrollment.
  if(!chatNotificationClientEnabled())return;
  const identity=()=>({owner:getAuthSnapshot().user,tenantId:useChatStore.getState().workspace?.id??null,
   active:AppState.currentState==='active',enabled:chatNotificationClientEnabled()&&!getAuthSnapshot().loading});
  const coordinator=createChatNotificationCoordinator({identity,permission:chatNotificationPermission,token:ordinaryApnsToken,
   register:registerChatNotificationToken,resolve:resolveChatNotification,open:destination=>{
    router.push({pathname:'/chat/[id]',params:{id:destination.conversationId,tenantId:String(destination.tenantId)}});
   },unavailable:()=>Alert.alert('Message unavailable','Open Team Chat to see your current conversations.')});
  let last=identity();
  const refresh=()=>void coordinator.refresh().catch(()=>{});
  const sync=()=>{
   const next=identity();if(next.owner!==last.owner||next.tenantId!==last.tenantId||next.active!==last.active||next.enabled!==last.enabled){
    const activityOnly=next.owner===last.owner&&next.tenantId===last.tenantId&&next.enabled===last.enabled;
    coordinator.invalidate(last.owner!==null&&next.owner!==last.owner,activityOnly);
    if(next.owner!==last.owner)void Notifications.dismissAllNotificationsAsync().catch(()=>{});
    last=next;refresh();void coordinator.resumeTap();
   }
  };
  const offAuth=addAuthChangeListener(sync),offChat=useChatStore.subscribe(sync);
  const activity=AppState.addEventListener('change',sync);
  const token=Notifications.addPushTokenListener(()=>{coordinator.invalidate();refresh();void coordinator.resumeTap();});
  const response=Notifications.addNotificationResponseReceivedListener(value=>{
   void coordinator.tap(value.notification.request.content.data);
   void Notifications.clearLastNotificationResponseAsync().catch(()=>{});
  });
  void Notifications.getLastNotificationResponseAsync().then(value=>{if(value){void coordinator.tap(value.notification.request.content.data);void Notifications.clearLastNotificationResponseAsync().catch(()=>{});}}).catch(()=>{});
  const request=()=>coordinator.refresh(true);enable=request;refresh();
  return ()=>{coordinator.stop();offAuth();offChat();activity.remove();token.remove();response.remove();if(enable===request)enable=async()=>({status:"unavailable"});};
 },[]);
 return null;
}
