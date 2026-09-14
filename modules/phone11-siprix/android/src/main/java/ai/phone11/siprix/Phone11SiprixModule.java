package ai.phone11.siprix;

import android.Manifest;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.firebase.messaging.FirebaseMessaging;
import com.siprix.*;
import java.util.*;

/** Lab-only adapter. One process-owned SDK; all commands/state changes run on main. */
public final class Phone11SiprixModule extends ReactContextBaseJavaModule {
 private static Runtime runtime;
 private static final Phone11SipEngineAdoption wakeAdoption=new Phone11SipEngineAdoption();
 private final Runtime rt;
 private final BridgeLease.Ticket owner;
 public Phone11SiprixModule(ReactApplicationContext context) {
  super(context);
  synchronized(Phone11SiprixModule.class) {
   if(runtime==null) runtime=new Runtime(context);
   rt=runtime; owner=rt.lease.acquire(); rt.context=context;
  }
 }
 @Override public String getName(){return "Phone11Siprix";}
 @Override public void invalidate(){rt.lease.release(owner);super.invalidate();}
 interface Action { Object run() throws Exception; }
 private void perform(Promise p, Action a) {
  rt.main.post(()->{if(!rt.lease.owns(owner)){p.reject("E_STALE_BRIDGE","React bridge ownership has changed");return;}try { Object v=a.run();
   if(v instanceof Map) p.resolve(Arguments.makeNativeMap((Map<String,Object>)v));
   else p.resolve(v);
  }catch(LabMedia.Failure e){p.reject(e.code,"Synthetic lab media operation failed");}
   catch(WakeEnrollmentFailure e){p.reject("WAKE_ENROLLMENT_UNAVAILABLE","Incoming call setup is unavailable");}
   catch(SdkError e){p.reject("E_SIPRIX_"+e.code,"Siprix command failed");}
   catch(MicrophonePermission e){p.reject("E_MICROPHONE_PERMISSION","Allow microphone access using the Microphone control before calling");}
   catch(SecurityException e){p.reject("E_LAB_SCOPE","Only the isolated Phone11 lab is allowed");}
   catch(UnsupportedOperationException e){p.reject("E_UNSUPPORTED","Not implemented for Android lab: "+e.getMessage());}
   catch(Exception e){p.reject("E_STATE","Invalid Android lab state or arguments");}
  });
 }
 private static void ok(int code) { if(code!=SiprixCore.kOK) throw new SdkError(code); }
 private static class SdkError extends RuntimeException { final int code; SdkError(int n){code=n;} }
 private static class MicrophonePermission extends RuntimeException {}
 private static class WakeEnrollmentFailure extends RuntimeException {}
 private void microphone() {if(getReactApplicationContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) throw new MicrophonePermission();}
 private AndroidSipScope configuredScope() throws PackageManager.NameNotFoundException {
  String packageName=getReactApplicationContext().getPackageName();
  ApplicationInfo app=getReactApplicationContext().getPackageManager().getApplicationInfo(packageName,PackageManager.GET_META_DATA);
  Bundle values=app.metaData;
  if(values==null||!values.getBoolean("ai.phone11.siprix.ANDROID_LAB_ENABLED",false))throw new SecurityException();
  return new AndroidSipScope(packageName,text(values,"ai.phone11.siprix.PACKAGE"),text(values,"ai.phone11.siprix.SIP_HOST"),
   text(values,"ai.phone11.siprix.SIP_PORT"),text(values,"ai.phone11.siprix.ACCOUNT_EXTENSIONS"),text(values,"ai.phone11.siprix.DESTINATIONS"));
 }
 private static String text(Bundle values,String key){Object value=values.get(key);return value==null?null:String.valueOf(value);}
 private static Map<String,Object> map(Object... kv) { Map<String,Object> m=new LinkedHashMap<>();for(int i=0;i<kv.length;i+=2)m.put((String)kv[i],kv[i+1]);return m; }
 private static final Set<String> WAKE_ENROLLMENT_KEYS=new HashSet<>(Arrays.asList(
  "bindingId","ownerUserId","tenantId","deviceId","sessionBinding","expiresAt","grant"));
 private static long positiveInteger(ReadableMap value,String key){
  if(!value.hasKey(key)||value.isNull(key)||value.getType(key)!=ReadableType.Number)throw new IllegalArgumentException();
  double number=value.getDouble(key);if(!Double.isFinite(number)||number<=0||number!=Math.rint(number)||number>9007199254740991d)throw new IllegalArgumentException();
  return (long)number;
 }
 private static String requiredString(ReadableMap value,String key){
  if(!value.hasKey(key)||value.isNull(key)||value.getType(key)!=ReadableType.String)throw new IllegalArgumentException();
  return value.getString(key);
 }
 private static Phone11WakeEnrollmentStore.Enrollment wakeEnrollment(ReadableMap value){
  if(value==null)throw new IllegalArgumentException();
  ReadableMapKeySetIterator keys=value.keySetIterator();int count=0;
  while(keys.hasNextKey()){if(!WAKE_ENROLLMENT_KEYS.contains(keys.nextKey()))throw new IllegalArgumentException();count++;}
  if(count!=WAKE_ENROLLMENT_KEYS.size())throw new IllegalArgumentException();
  return new Phone11WakeEnrollmentStore.Enrollment(requiredString(value,"bindingId"),
   positiveInteger(value,"ownerUserId"),positiveInteger(value,"tenantId"),requiredString(value,"deviceId"),
   requiredString(value,"sessionBinding"),positiveInteger(value,"expiresAt"),requiredString(value,"grant"));
 }
 private static Map<String,Object> wakeBinding(Phone11WakeEnrollmentStore.Binding value){
  return map("bindingId",value.bindingId,"ownerUserId",(double)value.ownerUserId,"tenantId",(double)value.tenantId,
   "deviceId",value.deviceId,"sessionBinding",value.sessionBinding,"expiresAt",(double)value.expiresAt);
 }
 static Phone11SipEngineAdoption.Decision offerIncomingWake(Phone11PendingWakeStore.Snapshot wake,long now){return wakeAdoption.adopt(wake,now);}
 static Phone11SipEngineAdoption.Decision answerIncomingWake(String callUUID,String bindingId,long now){return wakeAdoption.answer(callUUID,bindingId,now);}
 static Phone11SipEngineAdoption.Decision declineIncomingWake(String callUUID,String bindingId,long now){return wakeAdoption.decline(callUUID,bindingId,now);}
 static Phone11SipEngineAdoption.Decision cancelIncomingWake(String callUUID,String bindingId,long now){return wakeAdoption.cancel(callUUID,bindingId,now);}
 static Phone11SipEngineAdoption.Decision cleanupExpiredIncomingWake(long now){return wakeAdoption.cleanupExpired(now);}
 static void logoutIncomingWake(){wakeAdoption.logout();}
 static void publishFirebaseToken(String token){
  final Runtime current;
  synchronized(Phone11SiprixModule.class){current=runtime;}
  if(current==null||!current.context.hasActiveReactInstance()||!validProviderToken(token)
    ||!Phone11AndroidWakeRuntime.get(current.context).acceptsTokenRefresh())return;
  current.main.post(()->{
   if(!current.context.hasActiveReactInstance()||!Phone11AndroidWakeRuntime.get(current.context).acceptsTokenRefresh())return;
   current.context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
    .emit("Phone11VoipTokenChanged",Arguments.makeNativeMap(map("changed",true)));
  });
 }
 static void publishFirebaseDiagnosticChanged(){
  final Runtime current;
  synchronized(Phone11SiprixModule.class){current=runtime;}
  if(current==null||!current.context.hasActiveReactInstance())return;
  current.main.post(()->{
   if(!current.context.hasActiveReactInstance())return;
   current.context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
    .emit("Phone11FirebaseDiagnosticChanged",Arguments.makeNativeMap(map("changed",true)));
  });
 }
 private static boolean validProviderToken(String token){return token!=null&&!token.trim().isEmpty()&&token.length()<=4096;}
 private void resolveFirebaseDiagnostic(Promise p,Phone11FirebaseDiagnostic.Result result){
  try{
   Phone11FirebaseDiagnosticStore store=new Phone11FirebaseDiagnosticStore(getReactApplicationContext().getApplicationContext());
   store.replace(result);
   Map<String,Object> value=result.publicValue();
   value.put("enrollment",wakeEnrollmentDiagnostic());
   Phone11FirebaseDiagnostic.IngressReceipt ingress=store.readIngress();
   value.put("ingress",ingress==null?null:ingress.publicValue());
   p.resolve(Arguments.makeNativeMap(value));
 }catch(RuntimeException failure){p.reject("FIREBASE_DIAGNOSTIC_UNAVAILABLE","Firebase diagnostic persistence is unavailable");}
 }
 private Map<String,Object> wakeEnrollmentDiagnostic(){
  Phone11WakeEnrollmentStore.Binding binding=Phone11AndroidWakeRuntime.get(getReactApplicationContext())
   .wakeBinding(System.currentTimeMillis());
  return map("status",binding==null?"not_bound":"bound","expiresAt",binding==null?null:(double)binding.expiresAt);
 }
 @ReactMethod public void getFirebaseDiagnostic(Promise p){rt.main.post(()->{
  if(!rt.lease.owns(owner)){p.reject("E_STALE_BRIDGE","React bridge ownership has changed");return;}
  Phone11AndroidWakeRuntime.Status status=Phone11AndroidWakeRuntime.get(getReactApplicationContext()).status();
  long checkedAt=System.currentTimeMillis();
  if(status==Phone11AndroidWakeRuntime.Status.UNSUPPORTED_UNCOMMISSIONED){
   Map<String,Object> value=Phone11FirebaseDiagnostic.unavailable(checkedAt).publicValue();value.put("enrollment",map("status","not_bound","expiresAt",null));value.put("ingress",null);
   p.resolve(Arguments.makeNativeMap(value));return;
  }
  if(status!=Phone11AndroidWakeRuntime.Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS){
   Map<String,Object> value=Phone11FirebaseDiagnostic.misconfigured(checkedAt).publicValue();value.put("enrollment",map("status","not_bound","expiresAt",null));value.put("ingress",null);
   p.resolve(Arguments.makeNativeMap(value));return;
  }
  FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->rt.main.post(()->{
   if(!rt.lease.owns(owner)){p.reject("E_STALE_BRIDGE","React bridge ownership has changed");return;}
   String providerValue=task.isSuccessful()?task.getResult():null;
   resolveFirebaseDiagnostic(p,Phone11FirebaseDiagnostic.fromProviderValue(providerValue,System.currentTimeMillis()));
  }));
 });}
 private void providerToken(Promise p,boolean start){
  Phone11AndroidWakeRuntime wake=Phone11AndroidWakeRuntime.get(getReactApplicationContext());
  if(wake.status()!=Phone11AndroidWakeRuntime.Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS){p.reject("NOT_COMMISSIONED","Background calling is not commissioned");return;}
  final long revision=start?wake.startTokenUpdates():wake.currentTokenRevision();
  FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->rt.main.post(()->{
   if(!rt.lease.owns(owner)||!wake.ownsTokenRequest(revision,start)){p.reject("E_STALE_BRIDGE","React bridge ownership has changed");return;}
   String token=task.isSuccessful()?task.getResult():null;
   if(!validProviderToken(token)){p.reject("WAKE_TOKEN_UNAVAILABLE","Incoming call device token is unavailable");return;}
   p.resolve(token);
  }));
 }
 @ReactMethod public void getCapabilities(Promise p){perform(p,()->{
  Phone11AndroidWakeRuntime.Status status=Phone11AndroidWakeRuntime.get(getReactApplicationContext()).status();
  boolean available=status==Phone11AndroidWakeRuntime.Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS;
  return map("registrationAvailable",available,"closedAppCalling",false,"reason",available?"android_wake_enrollment_available":
   status==Phone11AndroidWakeRuntime.Status.UNSUPPORTED_UNCOMMISSIONED?"native_wake_not_commissioned":"android_wake_misconfigured");
 });}
 @ReactMethod public void createDeviceId(Promise p){perform(p,()->UUID.randomUUID().toString());}
 @ReactMethod public void start(Promise p){providerToken(p,true);}
 @ReactMethod public void currentToken(Promise p){providerToken(p,false);}
 @ReactMethod public void saveWakeEnrollment(ReadableMap value,Promise p){perform(p,()->{
  Phone11WakeEnrollmentStore.Enrollment candidate;
  try{candidate=wakeEnrollment(value);}catch(RuntimeException invalid){throw new WakeEnrollmentFailure();}
  Phone11PendingWakeStore.Decision decision=Phone11AndroidWakeRuntime.get(getReactApplicationContext())
   .saveEnrollment(candidate,System.currentTimeMillis());
  if(decision!=Phone11PendingWakeStore.Decision.ACCEPTED)throw new WakeEnrollmentFailure();return null;
 });}
 @ReactMethod public void getWakeBinding(Promise p){perform(p,()->{
  Phone11WakeEnrollmentStore.Binding value=Phone11AndroidWakeRuntime.get(getReactApplicationContext())
   .wakeBinding(System.currentTimeMillis());
  return value==null?null:wakeBinding(value);
 });}
 @ReactMethod public void stop(Promise p){perform(p,()->{
  Phone11AndroidWakeRuntime.get(getReactApplicationContext()).logout();wakeAdoption.logout();return null;
 });}
 @ReactMethod public void initialize(ReadableMap options,Promise p){perform(p,()->{
  if(!rt.initialized){
   rt.scope=configuredScope();
   if(rt.core==null)rt.core=new SiprixCore(getReactApplicationContext().getApplicationContext());
   long generation=++rt.generation;
   rt.core.setModelListener(rt.listener(generation));
   IniData ini=new IniData();ini.setLogLevelFile(IniData.LogLevel.NONE);ini.setLogLevelIde(IniData.LogLevel.NONE);
   ini.setTlsVerifyServer(true);ini.setSingleCallMode(true);ini.setUseProximity(false);ini.setUseTelState(false);
   ini.setRecordStereo(true);ini.setUnregOnDestroy(true);ini.setBrandName("Phone11 Lab");
   ok(rt.core.initialize(ini));rt.initialized=true;rt.sequence=0;
   wakeAdoption.attach(generation,rt.wakeCommands(generation));
  }
  return rt.snapshot();
 });}
 @ReactMethod public void getSnapshot(Promise p){perform(p,()->rt.snapshot());}
 @ReactMethod public void createAccount(ReadableMap cfg,Promise p){perform(p,()->{
  rt.ready();if(!rt.accounts.isEmpty())throw new IllegalStateException();
  String host=cfg.getString("sipServer"),ext=cfg.getString("sipExtension");
  if(!rt.scope.host().equalsIgnoreCase(host))throw new SecurityException();
  ext=rt.scope.account(ext);
  if(cfg.hasKey("port")&&!cfg.isNull("port")&&cfg.getInt("port")!=rt.scope.port())throw new SecurityException();
  for(String key:new String[]{"sipProxy","stunServer"})if(cfg.hasKey(key)&&!cfg.isNull(key)&&!cfg.getString(key).isEmpty())throw new SecurityException();
  if(!"UDP".equals(cfg.getString("transport"))&&!"TCP".equals(cfg.getString("transport")))throw new UnsupportedOperationException("TLS fixture");
  AccData data=new AccData();data.setSipServer(rt.scope.host()+":"+rt.scope.port());data.setSipExtension(ext);data.setSipAuthId(ext);
  data.setSipPassword(cfg.getString("sipPassword"));data.setExpireTime(0);
  data.setTranspProtocol(AccData.SipTransport.valueOf(cfg.getString("transport")));data.setTranspPort(0);
  data.setDisplayName("Phone11 Lab");data.setSecureMediaMode(AccData.SecureMediaMode.DISABLED);
  data.setIceEnabled(false);data.setRtcpMuxEnabled(false);data.setRewriteContactIp(true);data.setVerifyIncomingCall(true);
  data.resetAudioCodecs();data.addAudioCodec(AccData.AudioCodec.PCMA);data.addAudioCodec(AccData.AudioCodec.PCMU);data.addAudioCodec(AccData.AudioCodec.DTMF);
  if(cfg.hasKey("secureMedia")&&cfg.getInt("secureMedia")!=0)throw new UnsupportedOperationException("secure media fixture");
  SiprixCore.IdOutArg out=new SiprixCore.IdOutArg();ok(rt.core.accountAdd(data,out));
  Map<String,Object> a=map("id",""+out.value,"accountId",""+out.value,"registrationState","unregistered");rt.accounts.put(out.value,a);return a;
 });}
 @ReactMethod public void registerAccount(String id,int expires,Promise p){perform(p,()->{int n=rt.account(id);if(expires<30||expires>600)throw new IllegalArgumentException();ok(rt.core.accountRegister(n,expires));return null;});}
 @ReactMethod public void unregisterAccount(String id,Promise p){perform(p,()->{int n=rt.account(id);ok(rt.core.accountUnregister(n));wakeAdoption.accountRegistration(rt.generation,n,false);return null;});}
 @ReactMethod public void deleteAccount(String id,Promise p){perform(p,()->{int n=rt.account(id);if(!rt.calls.isEmpty())throw new IllegalStateException();ok(rt.core.accountDelete(n));rt.accounts.remove(n);wakeAdoption.accountRegistration(rt.generation,n,false);return null;});}
 @ReactMethod public void makeCall(String account,String destination,Promise p){perform(p,()->{
  microphone();int n=rt.account(account);if(!rt.calls.isEmpty())throw new IllegalStateException();
  String target=rt.scope.destination(destination);
  DestData dest=new DestData();dest.setAccountId(n);dest.setExtension(target);dest.setVideoCall(false);dest.setInviteTimeout(15);
  SiprixCore.IdOutArg out=new SiprixCore.IdOutArg();ok(rt.core.callInvite(dest,out));
  Map<String,Object> c=rt.newCall(out.value,n,"outgoing",target);rt.calls.put(out.value,c);rt.event("callDialing","call",new LinkedHashMap<>(c));return c;
 });}
 @ReactMethod public void answerCall(String id,Promise p){perform(p,()->{microphone();int n=rt.call(id);Map<String,Object> c=rt.calls.get(n);if("connected".equals(c.get("state"))||rt.answerPending.contains(n))return null;ok(rt.core.callAccept(n,false));rt.answerPending.add(n);return null;});}
 @ReactMethod public void hangupCall(String id,Promise p){perform(p,()->{int n=rt.call(id);if(rt.endPending.contains(n))return null;Map<String,Object> c=rt.calls.get(n);ok("incoming".equals(c.get("direction"))&&"ringing".equals(c.get("state"))?rt.core.callReject(n,486):rt.core.callBye(n));rt.endPending.add(n);return null;});}
 @ReactMethod public void setMute(String id,boolean muted,Promise p){perform(p,()->{int n=rt.call(id);ok(rt.core.callMuteMic(n,muted));rt.calls.get(n).put("muted",muted);rt.event("callMuted","call",new LinkedHashMap<>(rt.calls.get(n)));return null;});}
 @ReactMethod public void setHold(String id,boolean held,Promise p){perform(p,()->{
  int n=rt.call(id);if(rt.holdPending.contains(n))throw new IllegalStateException();
  if(Boolean.TRUE.equals(rt.calls.get(n).get("held"))!=held){ok(rt.core.callHold(n));rt.holdPending.add(n);}return null;
 });}
 @ReactMethod public void sendDtmf(String id,String digits,Promise p){perform(p,()->{int n=rt.call(id);if(!digits.matches("[0-9*#A-D]{1,32}"))throw new IllegalArgumentException();ok(rt.core.callSendDtmf(n,digits));return null;});}
 @ReactMethod public void setSpeaker(boolean enabled,Promise p){perform(p,()->{
  rt.ready();SiprixCore.AudioDevice device=enabled?SiprixCore.AudioDevice.SpeakerPhone:SiprixCore.AudioDevice.Earpiece;
  boolean found=false;for(int i=0;i<rt.core.dvcGetAudioDevices();i++)found|=rt.core.dvcGetAudioDevice(i)==device;
  if(!found)throw new UnsupportedOperationException("requested virtual audio route");rt.core.dvcSetAudioDevice(device);return null;
 });}
 @ReactMethod public void labStartMedia(String id,Promise p){perform(p,()->{int n=rt.call(id);if(!"connected".equals(rt.calls.get(n).get("state")))throw new IllegalStateException();return rt.media().start(n,rt.generation);});}
 @ReactMethod public void labInjectTone(String id,Promise p){perform(p,()->{int n=rt.call(id);if(!"connected".equals(rt.calls.get(n).get("state")))throw new IllegalStateException();return rt.media().inject(n,rt.generation);});}
 @ReactMethod public void labStopMedia(Promise p){perform(p,()->rt.media().stop());}
 @ReactMethod public void labClearMedia(Promise p){perform(p,()->rt.media().clear());}
 @ReactMethod public void destroy(Promise p){perform(p,()->{
  rt.destroy();return null;
 });}
 @ReactMethod public void handleNativeAudioSession(boolean active,Promise p){p.reject("E_UNSUPPORTED","Android audio belongs to Siprix; CallKit is iOS-only");}
 @ReactMethod public void bindForegroundWakeContext(ReadableMap b,ReadableMap s,Promise p){p.reject("E_UNSUPPORTED","Android authenticated FCM wake is not commissioned");}
 @ReactMethod public void adoptIncomingWake(ReadableMap b,ReadableMap s,Promise p){p.reject("E_UNSUPPORTED","Android authenticated FCM wake is not commissioned");}
 @ReactMethod public void restoreIncomingWakeDelegate(Promise p){p.reject("E_UNSUPPORTED","Android authenticated FCM wake is not commissioned");}
 @ReactMethod public void readCompletedWakeCalls(ReadableMap b,Promise p){p.reject("E_UNSUPPORTED","Android authenticated FCM wake history is unavailable");}
 @ReactMethod public void ackCompletedWakeCalls(ReadableMap b,ReadableArray ids,Promise p){p.reject("E_UNSUPPORTED","Android authenticated FCM wake history is unavailable");}
 @ReactMethod public void addListener(String name){}
 @ReactMethod public void removeListeners(int count){}

 static final class Runtime {
  final BridgeLease lease=new BridgeLease();
  ReactApplicationContext context; final Handler main=new Handler(Looper.getMainLooper());
  SiprixCore core;LabMedia media;AndroidSipScope scope;
  LabMedia media(){ready();if(media==null)media=new LabMedia(context,core,main,()->event("labMedia","labMedia",media.snapshot()),this::destroy);return media;}
  boolean initialized=false,trial=false;long generation=0,sequence=0;
  final Map<Integer,Map<String,Object>> accounts=new LinkedHashMap<>(),calls=new LinkedHashMap<>();
  final Set<Integer> answerPending=new HashSet<>(),endPending=new HashSet<>(),holdPending=new HashSet<>();
  Runtime(ReactApplicationContext c){context=c;}
  void destroy(){if(initialized){long endedGeneration=generation;wakeAdoption.detach(endedGeneration);ok(core.unInitialize());if(media!=null)media.onCoreDestroyed();core.setModelListener(null);initialized=false;scope=null;++generation;sequence=0;accounts.clear();calls.clear();answerPending.clear();endPending.clear();holdPending.clear();}}
  void ready(){if(!initialized||scope==null)throw new IllegalStateException();}
  int account(String s){ready();int id=Integer.parseInt(s);if(!accounts.containsKey(id))throw new IllegalStateException();return id;}
  int call(String s){ready();int id=Integer.parseInt(s);if(!calls.containsKey(id))throw new IllegalStateException();return id;}
  Map<String,Object> snapshot(){return map("initialized",initialized,"generation",(double)generation,"sequence",(double)sequence,"sdkVersion",initialized?core.getVersion():null,
   "accounts",new ArrayList<>(accounts.values()),"calls",new ArrayList<>(calls.values()),"audioSessionActive",connected(),"speaker",speaker(),"trialNotified",trial,"labMedia",media==null?null:media.snapshot());}
  boolean connected(){for(Map<String,Object> c:calls.values())if(c.containsKey("answeredAt"))return true;return false;}
  boolean speaker(){return initialized&&core.dvcGetSelAudioDevice()==SiprixCore.AudioDevice.SpeakerPhone;}
  void event(String type,String key,Object value){Map<String,Object> e=map("type",type,"generation",(double)generation,"sequence",(double)++sequence);if(key!=null)e.put(key,value);
   if(context.hasActiveReactInstance())context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11SiprixEvent",Arguments.makeNativeMap(e));}
  void audioEvent(){Map<String,Object> e=map("type","devicesAudioChanged","generation",(double)generation,"sequence",(double)++sequence,"audioSessionActive",connected(),"speaker",speaker());
   if(context.hasActiveReactInstance())context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11SiprixEvent",Arguments.makeNativeMap(e));}
  Map<String,Object> newCall(int id,int acc,String direction,String remote){return map("id",""+id,"callId",""+id,"accountId",""+acc,"direction",direction,"state",direction.equals("incoming")?"ringing":"dialing","remoteUri",remote,
   "hasVideo",false,"muted",false,"held",false,"holdState",0,"historyId",UUID.randomUUID().toString(),"startedAt",(double)System.currentTimeMillis());}
  Phone11SipEngineAdoption.Commands wakeCommands(final long commandGeneration){return new Phone11SipEngineAdoption.Commands(){
   public boolean answer(int id){
    if(!initialized||generation!=commandGeneration||!calls.containsKey(id)||answerPending.contains(id)
      ||context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)return false;
    int code=core.callAccept(id,false);if(code!=SiprixCore.kOK)return false;answerPending.add(id);return true;
   }
   public boolean decline(int id){
    if(!initialized||generation!=commandGeneration||!calls.containsKey(id)||endPending.contains(id))return false;
    Map<String,Object> call=calls.get(id);if(!"incoming".equals(call.get("direction"))||!"ringing".equals(call.get("state")))return false;
    int code=core.callReject(id,486);if(code!=SiprixCore.kOK)return false;endPending.add(id);return true;
   }
  };}
  void callback(long g,Runnable r){main.post(()->{if(initialized&&g==generation)r.run();});}
  void change(int id,String state,String type){Map<String,Object> c=calls.get(id);if(c==null)return;c.put("state",state);event(type,"call",new LinkedHashMap<>(c));}
  ISiprixModelListener listener(final long g){return new ISiprixModelListener(){
   public void onTrialModeNotified(){callback(g,()->{trial=true;event("trial",null,null);});}
   public void onDevicesAudioChanged(){callback(g,()->audioEvent());}
   public void onAccountRegState(int id,AccData.RegState state,String response){callback(g,()->{Map<String,Object>a=accounts.get(id);if(a==null)return;
    a.put("regState",state.getValue());a.put("registrationState",state==AccData.RegState.SUCCESS?"registered":state==AccData.RegState.FAILED?"failed":state==AccData.RegState.INPROGRES?"registering":"unregistered");wakeAdoption.accountRegistration(g,id,state==AccData.RegState.SUCCESS);event("registration","account",new LinkedHashMap<>(a));});}
   public void onNetworkState(String name,SiprixCore.NetworkState s){callback(g,()->event("network","networkState",s.getValue()));}
   public void onCallIncoming(int id,int acc,boolean video,String from,String to){callback(g,()->{
    if(calls.containsKey(id))return;
    if(!accounts.containsKey(acc)||!calls.isEmpty()||video){int err=core.callReject(id,486);if(err!=0)event("error","code",err);return;}
    Map<String,Object> c=newCall(id,acc,"incoming",from);calls.put(id,c);wakeAdoption.incoming(g,acc,id);
    wakeAdoption.adopt(Phone11AndroidWakeRuntime.get(context).snapshot(),System.currentTimeMillis());event("callIncoming","call",new LinkedHashMap<>(c));
   });}
   public void onCallConnected(int id,String from,String to,boolean video){callback(g,()->{Map<String,Object>c=calls.get(id);if(!LabScope.connected(c,System.currentTimeMillis()))return;answerPending.remove(id);change(id,"connected","callConnected");});}
   public void onCallTerminated(int id,int status){callback(g,()->{wakeAdoption.terminated(g,id);if(media!=null)media.onCallTerminated(id,g);Map<String,Object>c=calls.get(id);if(c==null)return;c.put("statusCode",status);change(id,"terminated","callTerminated");calls.remove(id);answerPending.remove(id);endPending.remove(id);holdPending.remove(id);});}
   public void onCallProceeding(int id,String response){callback(g,()->change(id,"proceeding","callProceeding"));}
   public void onCallHeld(int id,SiprixCore.HoldState state){callback(g,()->{Map<String,Object>c=calls.get(id);if(c==null)return;c.put("holdState",state.getValue());c.put("held",state.isLocal());holdPending.remove(id);change(id,state.isLocal()?"held":"connected","callHeld");});}
   public void onCallDtmfReceived(int id,int tone){callback(g,()->{if(calls.containsKey(id)){Map<String,Object>e=map("type","dtmf","generation",(double)generation,"sequence",(double)++sequence,"callId",""+id,"tone",tone);if(context.hasActiveReactInstance())context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11SiprixEvent",Arguments.makeNativeMap(e));}});}
   public void onCallVideoUpgradeRequested(int id){callback(g,()->core.callAcceptVideoUpgrade(id,false));}
   public void onSubscriptionState(int id,SubscrData.SubscrState s,String r){}
   public void onPlayerState(int id,SiprixCore.PlayerState s){callback(g,()->{if(media!=null)media.onPlayerState(id,s,g);});}
   public void onCallTransferred(int id,int s){}
   public void onCallRedirected(int a,int b,String t){}
   public void onCallVideoUpgraded(int id,boolean v){}
   public void onCallSwitched(int id){}
   public void onMessageSentState(int id,boolean s,String r){}
   public void onMessageIncoming(int a,int b,String f,String t){}
   public void onSipNotify(int a,String b,String c){}
   public void onVuMeterLevel(int a,int b){}
  };}
 }
}
