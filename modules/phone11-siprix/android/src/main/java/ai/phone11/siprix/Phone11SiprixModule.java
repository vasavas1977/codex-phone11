package ai.phone11.siprix;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.util.Map;

/** Default-off foreground source candidate; no native wake, service, FCM, or OS-call ownership. */
public final class Phone11SiprixModule extends ReactContextBaseJavaModule {
  private static Phone11CallRuntime runtime;
  private static ReactApplicationContext eventContext;
  private final Handler main=new Handler(Looper.getMainLooper());
  private long lease; private boolean attemptedLease=false,invalidated=false;
  public Phone11SiprixModule(ReactApplicationContext context){super(context);}
  @Override public String getName(){return "Phone11Siprix";}
  private interface Command{Object run();}
  @SuppressWarnings("unchecked")
  private void perform(Promise promise,Command command){main.post(()->{
    if(invalidated){promise.reject("E_STALE_BRIDGE","Phone session changed");return;}
    try{acquire();runtime.requireOwner(lease);Object result=command.run();promise.resolve(result instanceof Map?Arguments.makeNativeMap((Map<String,Object>)result):result);}
    catch(Phone11CallRuntime.Failure failure){promise.reject(failure.code,"Phone11 Android command was not accepted");}
    catch(LinkageError failure){promise.reject("E_ANDROID_SDK_RUNTIME","Pinned Android SIP runtime is unavailable");}
    catch(RuntimeException failure){promise.reject("E_INVALID_ARGUMENT","Invalid Phone11 Android state or arguments");}
  });}
  private void acquire(){if(attemptedLease)return;attemptedLease=true;
    if(runtime==null)runtime=new Phone11CallRuntime(new SiprixAndroidAdapter(getReactApplicationContext()),event->{
      if(eventContext!=null&&eventContext.hasActiveReactInstance())eventContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("Phone11SiprixEvent",Arguments.makeNativeMap(event));
    });lease=runtime.acquire();if(lease!=0)eventContext=getReactApplicationContext();}
  private void sourceGate(){
    if(!BuildConfig.FOREGROUND_SOURCE_ENABLED)throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");
    try{ApplicationInfo app=getReactApplicationContext().getPackageManager().getApplicationInfo(getReactApplicationContext().getPackageName(),PackageManager.GET_META_DATA);
      if(app.metaData==null||!app.metaData.getBoolean("ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED",false))throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");
    }catch(PackageManager.NameNotFoundException failure){throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");}
  }
  @ReactMethod public void initialize(ReadableMap options,Promise p){perform(p,()->{sourceGate();if(options==null||options.keySetIterator().hasNextKey())throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return runtime.initialize(lease);});}
  @ReactMethod public void getSnapshot(Promise p){perform(p,()->runtime.snapshot(lease));}
  @ReactMethod public void createAccount(ReadableMap config,Promise p){perform(p,()->{sourceGate();if(config==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return runtime.createAccount(lease,config.toHashMap());});}
  @ReactMethod public void registerAccount(String id,int expiry,Promise p){perform(p,()->{sourceGate();runtime.register(lease,id,expiry);return null;});}
  @ReactMethod public void unregisterAccount(String id,Promise p){perform(p,()->{runtime.unregister(lease,id);return null;});}
  @ReactMethod public void deleteAccount(String id,Promise p){perform(p,()->{runtime.delete(lease,id);return null;});}
  @ReactMethod public void makeCall(String account,String destination,Promise p){perform(p,()->{sourceGate();return runtime.invite(lease,account,destination);});}
  @ReactMethod public void answerCall(String id,Promise p){perform(p,()->{sourceGate();runtime.answer(lease,id);return null;});}
  @ReactMethod public void hangupCall(String id,Promise p){perform(p,()->{runtime.end(lease,id);return null;});}
  @ReactMethod public void setMute(String id,boolean muted,Promise p){perform(p,()->{runtime.mute(lease,id,muted);return null;});}
  @ReactMethod public void setHold(String id,boolean held,Promise p){perform(p,()->{runtime.hold(lease,id,held);return null;});}
  @ReactMethod public void sendDtmf(String id,String digits,Promise p){perform(p,()->{runtime.dtmf(lease,id,digits);return null;});}
  @ReactMethod public void setSpeaker(boolean enabled,Promise p){perform(p,()->{runtime.speaker(lease,enabled);return null;});}
  @ReactMethod public void destroy(Promise p){perform(p,()->{runtime.destroy(lease);return null;});}
  @ReactMethod public void getCapabilities(Promise p){perform(p,()->Phone11CallRuntime.map("registrationAvailable",false,"foregroundSourceCandidate",true,"closedAppCalling",false,"reason","android_native_acceptance_required"));}
  @ReactMethod public void getVideoCapabilities(Promise p){perform(p,()->Phone11CallRuntime.map("oneToOne",false,"cameraMute",false,"cameraSwitch",false,"nativeView",false));}
  private void unsupported(Promise p){perform(p,()->{throw new Phone11CallRuntime.Failure("E_UNSUPPORTED");});}
  @ReactMethod public void handleNativeAudioSession(boolean active,Promise p){unsupported(p);}
  @ReactMethod public void getPlaybackAudioRoute(Promise p){unsupported(p);}
  @ReactMethod public void setPlaybackAudioRoute(String route,Promise p){unsupported(p);}
  @ReactMethod public void resetPlaybackAudioRoute(Promise p){unsupported(p);}
  @ReactMethod public void bindForegroundWakeContext(ReadableMap binding,ReadableMap account,Promise p){unsupported(p);}
  @ReactMethod public void adoptIncomingWake(ReadableMap binding,ReadableMap account,Promise p){unsupported(p);}
  @ReactMethod public void restoreIncomingWakeDelegate(Promise p){unsupported(p);}
  @ReactMethod public void readCompletedWakeCalls(ReadableMap binding,Promise p){unsupported(p);}
  @ReactMethod public void ackCompletedWakeCalls(ReadableMap binding,ReadableArray ids,Promise p){unsupported(p);}
  @ReactMethod public void addListener(String eventName){}
  @ReactMethod public void removeListeners(double count){}
  @Override public void invalidate(){main.post(()->{invalidated=true;if(runtime!=null&&lease!=0){try{runtime.release(lease);}catch(RuntimeException failure){/* Retained quarantined runtime permits cleanup by the next bridge owner. */}finally{if(eventContext==getReactApplicationContext())eventContext=null;}}});super.invalidate();}
}
