package ai.phone11.siprix;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.*;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.util.Map;

/** Foreground trial plus independently gated native/wake candidates. Runtime ownership stays process local. */
public final class Phone11SiprixModule extends ReactContextBaseJavaModule {
  private static Phone11CallRuntime runtime;
  private static ReactApplicationContext eventContext;
  private final Handler main=new Handler(Looper.getMainLooper());
  private Phone11AndroidWakeCoordinator coordinator;
  private long lease; private boolean attemptedLease=false,invalidated=false;
  public Phone11SiprixModule(ReactApplicationContext context){super(context);}
  @Override public String getName(){return "Phone11Siprix";}
  private interface Command{Object run();}
  @SuppressWarnings("unchecked")
  private void perform(Promise promise,Command command){perform(promise,command,false);}
  @SuppressWarnings("unchecked")
  private void perform(Promise promise,Command command,boolean nativeRead){main.post(()->{
    if(invalidated){promise.reject("E_STALE_BRIDGE","Phone session changed");return;}
    try{acquire();runtime.requireOwner(lease);if(coordinator!=null&&!nativeRead)coordinator.requireBridge(lease);Object result=command.run();promise.resolve(result instanceof Map?Arguments.makeNativeMap((Map<String,Object>)result):result);}
    catch(Phone11CallRuntime.Failure failure){promise.reject(failure.code,"Phone11 Android command was not accepted");}
    catch(LinkageError failure){promise.reject("E_ANDROID_SDK_RUNTIME","Pinned Android SIP runtime is unavailable");}
    catch(RuntimeException failure){promise.reject("E_INVALID_ARGUMENT","Invalid Phone11 Android state or arguments");}
  });}
  private void acquire(){if(attemptedLease)return;attemptedLease=true;
    if(BuildConfig.NATIVE_CANDIDATE_ENABLED){coordinator=Phone11AndroidWakeCoordinator.get(getReactApplicationContext());runtime=coordinator.runtime;lease=coordinator.attach(event->{if(eventContext!=null&&eventContext.hasActiveReactInstance())eventContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11SiprixEvent",Arguments.makeNativeMap(event));},()->{if(eventContext!=null&&eventContext.hasActiveReactInstance())eventContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11VoipTokenChanged",Arguments.createMap());});if(lease!=0)eventContext=getReactApplicationContext();return;}
    if(runtime==null)runtime=new Phone11CallRuntime(new SiprixAndroidAdapter(getReactApplicationContext(),BuildConfig.CONSULTATION_SOURCE_ENABLED),event->{
      if(eventContext!=null&&eventContext.hasActiveReactInstance())eventContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11SiprixEvent",Arguments.makeNativeMap(event));
    },BuildConfig.CONSULTATION_SOURCE_ENABLED,(delay,task)->main.postDelayed(task,delay),BuildConfig.NATIVE_CANDIDATE_ENABLED);lease=runtime.acquire();if(lease!=0)eventContext=getReactApplicationContext();}
  private void sourceGate(){
    if(!BuildConfig.FOREGROUND_SOURCE_ENABLED)throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");
    try{ApplicationInfo app=getReactApplicationContext().getPackageManager().getApplicationInfo(getReactApplicationContext().getPackageName(),PackageManager.GET_META_DATA);
      Phone11ForegroundTrial.requireSource(BuildConfig.FOREGROUND_SOURCE_ENABLED,getReactApplicationContext().getPackageName(),app.metaData!=null&&app.metaData.getBoolean("ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED",false),BuildConfig.NATIVE_CANDIDATE_ENABLED,BuildConfig.WAKE_CANDIDATE_ENABLED);
      if(BuildConfig.WAKE_CANDIDATE_ENABLED&&(app.metaData==null||!app.metaData.getBoolean("ai.phone11.siprix.WAKE_CANDIDATE_ENABLED",false)))throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");
      if(BuildConfig.NATIVE_CANDIDATE_ENABLED&&(app.metaData==null||!app.metaData.getBoolean("ai.phone11.siprix.NATIVE_CANDIDATE_ENABLED",false)))throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");
    }catch(PackageManager.NameNotFoundException failure){throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");}
  }
  private void foregroundGate(){Phone11ForegroundTrial.requireForeground(getReactApplicationContext().getLifecycleState()==LifecycleState.RESUMED);}
  @ReactMethod public void initialize(ReadableMap options,Promise p){perform(p,()->{sourceGate();foregroundGate();if(options==null||options.keySetIterator().hasNextKey())throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return runtime.initialize(lease);});}
  @ReactMethod public void getSnapshot(Promise p){perform(p,()->coordinator==null?runtime.snapshot(lease):coordinator.snapshot(),true);}
  @ReactMethod public void createAccount(ReadableMap config,Promise p){perform(p,()->{sourceGate();foregroundGate();if(config==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");Map<String,Object> value=config.toHashMap();Map<String,Object> result=runtime.createAccount(lease,value);if(coordinator!=null)coordinator.rememberAccount(value);return result;});}
  @ReactMethod public void registerAccount(String id,int expiry,Promise p){perform(p,()->{sourceGate();foregroundGate();runtime.register(lease,id,expiry);return null;});}
  @ReactMethod public void unregisterAccount(String id,Promise p){perform(p,()->{runtime.unregister(lease,id);return null;});}
  @ReactMethod public void deleteAccount(String id,Promise p){perform(p,()->{runtime.delete(lease,id);return null;});}
  @ReactMethod public void makeCall(String account,String destination,Promise p){perform(p,()->{sourceGate();foregroundGate();if(coordinator!=null)coordinator.localAudioReady();Map<String,Object> result=runtime.invite(lease,account,destination);if(coordinator!=null)coordinator.startLocalAudio();return result;});}
  @ReactMethod public void answerCall(String id,Promise p){perform(p,()->{sourceGate();foregroundGate();if(coordinator!=null&&coordinator.ownsWake())coordinator.answerFromBridge(id);else{if(coordinator!=null)coordinator.localAudioReady();runtime.answer(lease,id);if(coordinator!=null)coordinator.startLocalAudio();}return null;});}
  @ReactMethod public void hangupCall(String id,Promise p){perform(p,()->{runtime.end(lease,id);return null;});}
  @ReactMethod public void setMute(String id,boolean muted,Promise p){perform(p,()->{runtime.mute(lease,id,muted);return null;});}
  @ReactMethod public void setHold(String id,boolean held,Promise p){perform(p,()->{runtime.hold(lease,id,held);return null;});}
  @ReactMethod public void sendDtmf(String id,String digits,Promise p){perform(p,()->{runtime.dtmf(lease,id,digits);return null;});}
  @ReactMethod public void setSpeaker(boolean enabled,Promise p){perform(p,()->{runtime.speaker(lease,enabled);return null;});}
  private void candidateGate(){sourceGate();if(!BuildConfig.NATIVE_CANDIDATE_ENABLED)throw new Phone11CallRuntime.Failure("E_UNSUPPORTED");}
  @ReactMethod public void runNativeSdkSmoke(Promise p){perform(p,()->{candidateGate();foregroundGate();return runtime.smoke(lease);});}
  @ReactMethod public void transferCall(String id,String destination,String request,Promise p){perform(p,()->{candidateGate();foregroundGate();runtime.transfer(lease,id,destination,request);return null;});}
  private void consultationGate(){sourceGate();if(!BuildConfig.CONSULTATION_SOURCE_ENABLED)throw new Phone11CallRuntime.Failure("E_UNSUPPORTED");}
  @ReactMethod public void createTransferRequestId(Promise p){perform(p,()->{sourceGate();if(!BuildConfig.CONSULTATION_SOURCE_ENABLED&&!BuildConfig.NATIVE_CANDIDATE_ENABLED)throw new Phone11CallRuntime.Failure("E_UNSUPPORTED");foregroundGate();return runtime.createTransferRequestId(lease);});}
  @ReactMethod public void beginConsultation(String id,String destination,String request,Promise p){perform(p,()->{consultationGate();foregroundGate();runtime.beginConsultation(lease,id,destination,request);return null;});}
  @ReactMethod public void continueConsultation(String id,String request,Promise p){perform(p,()->{consultationGate();foregroundGate();runtime.continueConsultation(lease,id,request);return null;});}
  @ReactMethod public void cancelConsultation(String id,String request,Promise p){perform(p,()->{consultationGate();runtime.cancelConsultation(lease,id,request);return null;});}
  @ReactMethod public void completeConsultation(String id,String request,String transfer,Promise p){perform(p,()->{consultationGate();foregroundGate();runtime.completeConsultation(lease,id,request,transfer);return null;});}
  @ReactMethod public void destroy(Promise p){perform(p,()->{if(coordinator!=null&&coordinator.ownsWake())coordinator.revoke();else runtime.destroy(lease);return null;});}
  @ReactMethod public void getCapabilities(Promise p){perform(p,()->coordinator==null?Phone11CallRuntime.map("registrationAvailable",false,"foregroundSourceCandidate",true,"closedAppCalling",false,"reason","android_native_acceptance_required"):coordinator.capabilities(),true);}
  @ReactMethod public void start(Promise p){wakeToken(p);}
  @ReactMethod public void currentToken(Promise p){wakeToken(p);}
  private void wakeToken(Promise p){main.post(()->{try{if(invalidated)throw new Phone11CallRuntime.Failure("E_STALE_BRIDGE");sourceGate();acquire();if(coordinator==null)throw new Phone11CallRuntime.Failure("E_UNSUPPORTED");coordinator.token(new Phone11WakeProvider.Result(){public void done(String token){if(invalidated)p.reject("E_STALE_BRIDGE","Phone session changed");else p.resolve(token);}public void failed(){p.reject("E_WAKE_PROVIDER","Native Android push is unavailable");}});}catch(RuntimeException failure){p.reject("E_WAKE_PROVIDER","Native Android push is unavailable");}});}
  @ReactMethod public void createDeviceId(Promise p){perform(p,()->java.util.UUID.randomUUID().toString(),true);}
  @ReactMethod public void stop(Promise p){perform(p,()->{if(coordinator!=null)coordinator.revoke();return null;},true);}
  @ReactMethod public void saveWakeEnrollment(ReadableMap value,Promise p){perform(p,()->{candidateGate();if(coordinator==null||value==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");coordinator.save(value.toHashMap());return null;},true);}
  @ReactMethod public void getWakeBinding(Promise p){perform(p,()->coordinator==null?null:coordinator.binding(),true);}
  // This is a build contract for a trial candidate, not wake or media acceptance.
  @ReactMethod public void getForegroundCapabilities(Promise p){main.post(()->{
    if(invalidated){p.reject("E_STALE_BRIDGE","Phone session changed");return;}
    try{sourceGate();p.resolve(Arguments.makeNativeMap(Phone11ForegroundTrial.capabilities(BuildConfig.CONSULTATION_SOURCE_ENABLED,BuildConfig.NATIVE_CANDIDATE_ENABLED,BuildConfig.WAKE_CANDIDATE_ENABLED)));}
    catch(Phone11CallRuntime.Failure failure){p.reject(failure.code,"Android foreground trial is not enabled");}
    catch(RuntimeException failure){p.reject("E_ANDROID_SOURCE_GATE","Android foreground trial configuration is unavailable");}
  });}
  @ReactMethod public void getVideoCapabilities(Promise p){perform(p,()->Phone11CallRuntime.map("oneToOne",false,"cameraMute",false,"cameraSwitch",false,"nativeView",false));}
  private void unsupported(Promise p){perform(p,()->{throw new Phone11CallRuntime.Failure("E_UNSUPPORTED");});}
  @ReactMethod public void handleNativeAudioSession(boolean active,Promise p){unsupported(p);}
  @ReactMethod public void getPlaybackAudioRoute(Promise p){unsupported(p);}
  @ReactMethod public void setPlaybackAudioRoute(String route,Promise p){unsupported(p);}
  @ReactMethod public void resetPlaybackAudioRoute(Promise p){unsupported(p);}
  @ReactMethod public void bindForegroundWakeContext(ReadableMap binding,ReadableMap account,Promise p){perform(p,()->{candidateGate();if(coordinator==null||binding==null||account==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");coordinator.bindForeground(binding.toHashMap(),account.toHashMap());return null;},true);}
  @ReactMethod public void adoptIncomingWake(ReadableMap binding,ReadableMap account,Promise p){perform(p,()->{candidateGate();if(coordinator==null||binding==null||account==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return coordinator.adopt(binding.toHashMap(),account.toHashMap());},true);}
  @ReactMethod public void restoreIncomingWakeDelegate(Promise p){perform(p,()->{candidateGate();return null;},true);}
  @ReactMethod public void readCompletedWakeCalls(ReadableMap binding,Promise p){perform(p,()->{candidateGate();if(coordinator==null||binding==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return Arguments.makeNativeArray(coordinator.completed(binding.toHashMap()));},true);}
  @ReactMethod public void ackCompletedWakeCalls(ReadableMap binding,ReadableArray ids,Promise p){perform(p,()->{candidateGate();if(coordinator==null||binding==null||ids==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");java.util.List<String> values=new java.util.ArrayList<>();for(Object id:ids.toArrayList()){if(!(id instanceof String))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");values.add((String)id);}coordinator.ackCompleted(binding.toHashMap(),values);return null;},true);}
  @ReactMethod public void addListener(String eventName){}
  @ReactMethod public void removeListeners(double count){}
  @Override public void invalidate(){main.post(()->{invalidated=true;if(runtime!=null&&lease!=0){try{if(coordinator!=null)coordinator.detach(lease);else runtime.release(lease);}catch(RuntimeException failure){/* Retained quarantined runtime permits cleanup by the next bridge owner. */}finally{if(eventContext==getReactApplicationContext())eventContext=null;}}});super.invalidate();}
}
