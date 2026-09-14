package ai.phone11.siprix;

import android.Manifest;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.siprix.*;
import java.util.*;

/** Lab-only adapter. One process-owned SDK; all commands/state changes run on main. */
public final class Phone11SiprixModule extends ReactContextBaseJavaModule {
 private static Runtime runtime;
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
 @ReactMethod public void unregisterAccount(String id,Promise p){perform(p,()->{ok(rt.core.accountUnregister(rt.account(id)));return null;});}
 @ReactMethod public void deleteAccount(String id,Promise p){perform(p,()->{int n=rt.account(id);if(!rt.calls.isEmpty())throw new IllegalStateException();ok(rt.core.accountDelete(n));rt.accounts.remove(n);return null;});}
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
  void destroy(){if(initialized){ok(core.unInitialize());if(media!=null)media.onCoreDestroyed();core.setModelListener(null);initialized=false;scope=null;++generation;sequence=0;accounts.clear();calls.clear();answerPending.clear();endPending.clear();holdPending.clear();}}
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
  void callback(long g,Runnable r){main.post(()->{if(initialized&&g==generation)r.run();});}
  void change(int id,String state,String type){Map<String,Object> c=calls.get(id);if(c==null)return;c.put("state",state);event(type,"call",new LinkedHashMap<>(c));}
  ISiprixModelListener listener(final long g){return new ISiprixModelListener(){
   public void onTrialModeNotified(){callback(g,()->{trial=true;event("trial",null,null);});}
   public void onDevicesAudioChanged(){callback(g,()->audioEvent());}
   public void onAccountRegState(int id,AccData.RegState state,String response){callback(g,()->{Map<String,Object>a=accounts.get(id);if(a==null)return;
    a.put("regState",state.getValue());a.put("registrationState",state==AccData.RegState.SUCCESS?"registered":state==AccData.RegState.FAILED?"failed":state==AccData.RegState.INPROGRES?"registering":"unregistered");event("registration","account",new LinkedHashMap<>(a));});}
   public void onNetworkState(String name,SiprixCore.NetworkState s){callback(g,()->event("network","networkState",s.getValue()));}
   public void onCallIncoming(int id,int acc,boolean video,String from,String to){callback(g,()->{
    if(calls.containsKey(id))return;
    if(!accounts.containsKey(acc)||!calls.isEmpty()||video){int err=core.callReject(id,486);if(err!=0)event("error","code",err);return;}
    Map<String,Object> c=newCall(id,acc,"incoming",from);calls.put(id,c);event("callIncoming","call",new LinkedHashMap<>(c));
   });}
   public void onCallConnected(int id,String from,String to,boolean video){callback(g,()->{Map<String,Object>c=calls.get(id);if(!LabScope.connected(c,System.currentTimeMillis()))return;answerPending.remove(id);change(id,"connected","callConnected");});}
   public void onCallTerminated(int id,int status){callback(g,()->{if(media!=null)media.onCallTerminated(id,g);Map<String,Object>c=calls.get(id);if(c==null)return;c.put("statusCode",status);change(id,"terminated","callTerminated");calls.remove(id);answerPending.remove(id);endPending.remove(id);holdPending.remove(id);});}
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
