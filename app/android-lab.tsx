import { useEffect, useState } from "react";
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import type { Phone11SiprixModule, Snapshot } from "../modules/phone11-siprix";

export default function AndroidLab() {
 if (process.env.EXPO_PUBLIC_PHONE11_ANDROID_LAB !== "1" || Platform.OS !== "android") return <Redirect href="/" />;
 return <Lab />;
}
function Lab() {
 const colors=useColors();const [state,setState]=useState<Snapshot|null>(null);
 const [password,setPassword]=useState("");const [error,setError]=useState("");
 const [events,setEvents]=useState<Array<{type:string;state?:string;sequence:number;generation:number;callId?:string;statusCode?:number}>>([]);
 const [busy,setBusy]=useState(false);const [ended,setEnded]=useState(0);
 const bridge=NativeModules.Phone11Siprix as (Phone11SiprixModule & {labStartMedia(id:string):Promise<unknown>;labInjectTone(id:string):Promise<unknown>;labStopMedia():Promise<unknown>;labClearMedia():Promise<unknown>})|undefined;
 const refresh=async()=>{if(bridge)setState(await bridge.getSnapshot());};
 useEffect(()=>{
  if(!bridge){setError("E_NATIVE_MODULE_MISSING");return;}
  void refresh();
  const sub=new NativeEventEmitter(bridge as never).addListener("Phone11SiprixEvent",e=>{
   setEvents(old=>[...old.slice(-39),{type:e.type,state:e.call?.state,sequence:e.sequence,generation:e.generation,callId:e.call?.callId,statusCode:e.call?.statusCode}]);
   if(e.type==="callTerminated")setEnded(n=>n+1);void refresh();
  });return()=>sub.remove();
 },[]);
 async function run(action:()=>Promise<unknown>){if(busy)return;setBusy(true);setError("");try{await action();await refresh();}catch(e){setError(String((e as {code?:string}).code||"E_COMMAND"));}finally{setBusy(false);}}
 const call=state?.calls[0];const account=state?.accounts[0];
 const button=(label:string,action:()=>Promise<unknown>)=><Pressable accessibilityRole="button" accessibilityLabel={label} testID={`lab-${label}`} disabled={busy} onPress={()=>void run(action)} style={{backgroundColor:colors.surface,padding:14,borderRadius:12,marginBottom:8}}><Text style={{color:colors.primary,fontWeight:"600"}}>{label}</Text></Pressable>;
 const observed=JSON.stringify({initialized:state?.initialized??false,sdk:state?.sdkVersion??null,generation:state?.generation,sequence:state?.sequence,registration:account?.registrationState??"none",call:call?.state??"none",muted:call?.muted??false,held:call?.held??false,ended,error,events,callCount:state?.calls.length??0,labMedia:(state as Snapshot & {labMedia?:unknown})?.labMedia});
 return <ScreenContainer><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:20,gap:8}}>
  <Text style={{fontSize:26,fontWeight:"700",color:colors.foreground}}>Phone11 Android Lab</Text>
  <Text style={{color:colors.muted}}>Isolated synthetic calls • real Siprix • no production accounts</Text>
  <Text accessibilityLabel={`lab-state:${observed}`} testID="lab-state" style={{color:colors.foreground,fontSize:12}}>SDK: {state?.sdkVersion??"not initialized"}{"\n"}Registration: {account?.registrationState??"none"} • Call: {call?.state??"none"}{"\n"}Completed: {ended} • {error||"No command error"}</Text>
  {button("Initialize",()=>bridge!.initialize({}))}
  {button("Microphone",()=>PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))}
  <TextInput accessibilityLabel="Lab password" testID="lab-password" secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none" placeholder="Per-run synthetic password" placeholderTextColor={colors.muted} style={{color:colors.foreground,borderColor:colors.border,borderWidth:1,borderRadius:12,padding:12}}/>
  {button("Register",async()=>{const a=await bridge!.createAccount({sipServer:"10.0.2.2",sipExtension:"7101",sipPassword:password,transport:"UDP",secureMedia:0});setPassword("");await bridge!.registerAccount(a.accountId,120);})}
  <View style={{flexDirection:"row",gap:8,flexWrap:"wrap"}}>
   {button("Call tone",()=>bridge!.makeCall(account!.accountId,"7190"))}
   {button("Call peer",()=>bridge!.makeCall(account!.accountId,"7102"))}
   {button("Answer",()=>bridge!.answerCall(call!.callId))}
   {button("Hang up",()=>bridge!.hangupCall(call!.callId))}
   {button("Mute",()=>bridge!.setMute(call!.callId,!call!.muted))}
   {button("Hold",()=>bridge!.setHold(call!.callId,!call!.held))}
   {button("DTMF",()=>bridge!.sendDtmf(call!.callId,"123#"))}
   {button("Speaker",()=>bridge!.setSpeaker(true))}
  </View>
  <View style={{flexDirection:"row",gap:8,flexWrap:"wrap"}}>
   {button("Capture media",()=>bridge!.labStartMedia(call!.callId))}
   {button("Inject tone",()=>bridge!.labInjectTone(call!.callId))}
   {button("Stop capture",()=>bridge!.labStopMedia())}
   {button("Clear media",()=>bridge!.labClearMedia())}
  </View>
  {button("Destroy",()=>bridge!.destroy())}
  {button("Shared Phone11 UI",async()=>{await bridge!.destroy();router.replace("/");})}
  <Text style={{color:colors.muted}}>FCM and process-death wake are unavailable in this build. This screen verifies the native bridge; shared Phone11 screens remain the source for product UI.</Text>
 </ScrollView></ScreenContainer>;
}
