package ai.phone11.siprix;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.*;
import org.json.JSONObject;
import java.util.*;

/** Main-thread process owner: React is a client, never a second SIP instance. */
final class Phone11AndroidWakeCoordinator {
  interface TokenSignal {void changed();}
  private static Phone11AndroidWakeCoordinator instance;private static TokenSignal signal;
  static Phone11AndroidWakeCoordinator get(Context context){if(instance==null)instance=new Phone11AndroidWakeCoordinator(context.getApplicationContext());return instance;}
  static void tokenChanged(){new Handler(Looper.getMainLooper()).post(()->{if(signal!=null)signal.changed();});}
  final Handler main=new Handler(Looper.getMainLooper());final Phone11CallRuntime runtime;private final SiprixAndroidAdapter adapter;
  private final Context context;private final Phone11WakeHistory history;private final Phone11WakeStore store;private final Phone11WakeHttp http;private final Phone11AndroidWakeState state=new Phone11AndroidWakeState();
  private Phone11WakeCpuState.Owner wakeCpuOwner;
  private long lease;private boolean bridgeAttached,adopted,answerRequested,serverReady,finishing,recordHistory,forceShutdown;private Phone11CallRuntime.Sink bridge;
  private String accountHash,foregroundBinding,callId;private JSONObject enrollment;private Phone11AndroidWakeState.Ticket active;private Phone11IncomingCallService service;
  private Phone11ConnectionService.Call connection;private Phone11IncomingCallService localService;private String localCallId;
  private Phone11AndroidWakeCoordinator(Context context){this.context=context;history=new Phone11WakeHistory(context);store=new Phone11WakeStore(context);http=new Phone11WakeHttp(main);adapter=new SiprixAndroidAdapter(context,BuildConfig.CONSULTATION_SOURCE_ENABLED);runtime=new Phone11CallRuntime(adapter,this::event,BuildConfig.CONSULTATION_SOURCE_ENABLED,(delay,task)->main.postDelayed(task,delay),true);}
  long attach(Phone11CallRuntime.Sink sink,TokenSignal tokenSignal){if(bridgeAttached)return 0;if(lease==0)lease=runtime.acquire();bridgeAttached=true;bridge=sink;signal=tokenSignal;return lease;}
  void detach(long owner){if(owner!=lease)return;bridgeAttached=false;bridge=null;signal=null;adopted=false;if(active==null&&localCallId==null){try{runtime.release(lease);}finally{lease=0;accountHash=foregroundBinding=null;}}}
  void requireBridge(long owner){runtime.requireOwner(owner);if(active!=null&&!adopted)throw new Phone11CallRuntime.Failure("E_NATIVE_WAKE_OWNED");}
  boolean ownsWake(){return active!=null;}
  private long now(){return System.currentTimeMillis();}
  private void gate(){try{if(!BuildConfig.WAKE_CANDIDATE_ENABLED||!BuildConfig.NATIVE_CANDIDATE_ENABLED)throw new Exception();android.content.pm.ApplicationInfo app=context.getPackageManager().getApplicationInfo(context.getPackageName(),PackageManager.GET_META_DATA);if(app.metaData==null||!app.metaData.getBoolean("ai.phone11.siprix.NATIVE_CANDIDATE_ENABLED",false)||!app.metaData.getBoolean("ai.phone11.siprix.WAKE_CANDIDATE_ENABLED",false))throw new Exception();Phone11ForegroundTrial.requireSource(BuildConfig.FOREGROUND_SOURCE_ENABLED,context.getPackageName(),app.metaData.getBoolean("ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED",false),true,true);Phone11WakeHttp.origin();}catch(Exception failure){throw new Phone11CallRuntime.Failure("E_ANDROID_WAKE_GATE");}}

  boolean available(){try{gate();return Phone11WakeProvider.available(context)&&permissions()&&Phone11ConnectionService.register(context);}catch(RuntimeException failure){return false;}}
  private boolean permissions(){return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED&&(Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);}
  void token(Phone11WakeProvider.Result result){gate();if(!available()){result.failed();return;}Phone11WakeProvider.token(context,result);}
  Map<String,Object> capabilities(){return Phone11CallRuntime.map("registrationAvailable",available(),"closedAppCalling",false,"wakeSourceCandidate",BuildConfig.WAKE_CANDIDATE_ENABLED,"reason","android_native_acceptance_required");}
  void save(Map<String,Object> value){gate();JSONObject next=new JSONObject(value);Phone11WakeStore.validate(next);Phone11AndroidWakeState.Binding identity=Phone11WakeStore.binding(next);if(identity.expiresAt<=now())throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");if(active!=null&&(!identity.sameIdentity(state.binding())||enrollment==null||!Objects.equals(next.optString("grant"),enrollment.optString("grant"))))throw new Phone11CallRuntime.Failure("E_NATIVE_WAKE_OWNED");store.write(next);state.bind(identity,now());}
  Map<String,Object> binding(){gate();JSONObject saved=store.read();return saved!=null&&Phone11WakeStore.binding(saved).expiresAt>now()?Phone11WakeStore.publicBinding(saved):null;}
  List<Map<String,Object>> completed(Map<String,Object> requested){gate();return history.read(requested,binding());}
  void ackCompleted(Map<String,Object> requested,List<String> ids){gate();history.ack(requested,binding(),ids);}
  void revoke(){recordHistory=false;forceShutdown=true;RuntimeException cleanup=null;try{if(active!=null)finish(true);if(active==null&&lease!=0){try{runtime.destroy(lease);}finally{if(localCallId!=null)localEnded();}}}catch(RuntimeException failure){cleanup=failure;}finally{releaseWakeCpu();state.revoke();store.write(null);foregroundBinding=null;adopted=false;history.clear();}if(cleanup!=null)throw cleanup;}
  void localAudioReady(){if(!BuildConfig.WAKE_CANDIDATE_ENABLED)return;gate();if(!permissions()||!Phone11ConnectionService.register(context))throw new Phone11CallRuntime.Failure("E_WAKE_UNAVAILABLE");}
  void startLocalAudio(){if(!BuildConfig.WAKE_CANDIDATE_ENABLED)return;localAudioReady();List<?> calls=(List<?>)runtime.snapshot(lease).get("calls");if(calls.isEmpty())throw new Phone11CallRuntime.Failure("E_CALL_STATE");localCallId=(String)((Map<?,?>)calls.get(0)).get("id");try{Intent intent=new Intent(context,Phone11IncomingCallService.class).setAction(Phone11IncomingCallService.LOCAL);if(Build.VERSION.SDK_INT>=26)context.startForegroundService(intent);else context.startService(intent);}catch(RuntimeException failure){String id=localCallId;localCallId=null;runtime.end(lease,id);throw new Phone11CallRuntime.Failure("E_ANDROID_SERVICE_START");}}

  void localService(Phone11IncomingCallService value){if(active!=null){value.done();return;}localService=value;Map<String,Object> snapshot=runtime.snapshot(lease);List<?> calls=(List<?>)snapshot.get("calls");if(calls.isEmpty()||!value.microphone()){value.done();localService=null;if(localCallId!=null){try{runtime.end(lease,localCallId);}catch(RuntimeException ignored){try{runtime.destroy(lease);}catch(RuntimeException cleanupFailure){}}finally{localCallId=null;}}return;}localCallId=(String)((Map<?,?>)calls.get(0)).get("id");value.show("local",Long.toString(lease),lease,true);}
  void endLocal(String uuid,String binding,long epoch){if("local".equals(uuid)&&Long.toString(lease).equals(binding)&&epoch==lease&&localCallId!=null){try{runtime.end(lease,localCallId);}catch(RuntimeException failure){try{runtime.destroy(lease);}finally{localEnded();}}}}
  private void localEnded(){localCallId=null;if(localService!=null){Phone11IncomingCallService value=localService;localService=null;value.done();}if(!bridgeAttached&&active==null){try{runtime.destroy(lease);}catch(RuntimeException ignored){/* Retain quarantine for next bridge cleanup. */}accountHash=foregroundBinding=null;}}
  void rememberAccount(Map<String,Object> config){accountHash=fingerprint(config);}
  void bindForeground(Map<String,Object> binding,Map<String,Object> config){gate();Phone11AndroidWakeState.Binding identity=Phone11WakeStore.binding(new JSONObject(binding));JSONObject saved=store.read();if(saved==null||!identity.sameIdentity(Phone11WakeStore.binding(saved))||identity.expiresAt<=now()||!Objects.equals(accountHash,fingerprint(config)))throw new Phone11CallRuntime.Failure("E_WAKE_OWNER");foregroundBinding=identity.bindingId;}
  Map<String,Object> adopt(Map<String,Object> binding,Map<String,Object> config){gate();Phone11AndroidWakeState.Binding identity=Phone11WakeStore.binding(new JSONObject(binding));if(active==null||!state.isCurrent(active,now())||!identity.sameIdentity(state.binding())||identity.expiresAt<=now()||!Objects.equals(accountHash,fingerprint(config)))throw new Phone11CallRuntime.Failure("E_WAKE_OWNER");adopted=true;return snapshot();}
  Map<String,Object> snapshot(){Map<String,Object> result=runtime.snapshot(lease);if(active!=null&&!finishing&&enrollment!=null&&state.binding()!=null){Map<String,Object> wake=new LinkedHashMap<>(Phone11WakeStore.publicBinding(enrollment));wake.put("callUUID",active.callUUID);wake.put("expiresAt",active.expiresAt);wake.put("grantExpiresAt",state.binding().expiresAt);wake.put("v",1);result.put("nativeWake",wake);}return result;}
  private static String fingerprint(Map<String,Object> config){return Phone11AndroidAccountIdentity.fingerprint(config);}

  void receive(Phone11IncomingCallService owner,String uuid,String binding,long expiry,String handoff){
    // An unrelated delivery never owns or stops an existing service/call.
    if(active!=null){if(active.callUUID.equals(uuid)&&active.bindingId.equals(binding)&&state.isCurrent(active,now()))owner.show(uuid,binding,active.epoch,state.phase()==Phone11AndroidWakeState.Phase.ACTIVE);return;}
    if(localCallId!=null)return;
    try{gate();if(!available()||expiry<=now()||expiry-now()>30000)throw new Phone11CallRuntime.Failure("E_WAKE_UNAVAILABLE");JSONObject saved=store.read();if(saved==null)throw new Phone11CallRuntime.Failure("E_WAKE_OWNER");
      if(lease==0)lease=runtime.acquire();Map<String,Object> before=runtime.snapshot(lease);if(Boolean.TRUE.equals(before.get("cleanupRequired"))||!((List<?>)before.get("calls")).isEmpty()||(!((List<?>)before.get("accounts")).isEmpty()&&!Objects.equals(binding,foregroundBinding))){owner.done();return;}
      state.bind(Phone11WakeStore.binding(saved),now());Phone11AndroidWakeState.Ticket ticket=state.receive(binding,uuid,expiry,now());if(ticket==null)throw new Phone11CallRuntime.Failure("E_WAKE_OWNER");
      active=ticket;enrollment=saved;service=owner;
      wakeCpuOwner=Phone11WakeCpuLock.get(context).adopt(handoff,uuid,binding,ticket.epoch,ticket.expiresAt);
      if(wakeCpuOwner==null)throw new Phone11CallRuntime.Failure("E_WAKE_CPU_HANDOFF");
      recordHistory=true;forceShutdown=false;callId=null;connection=null;adopted=answerRequested=serverReady=false;owner.show(uuid,binding,ticket.epoch,false);
      final Phone11AndroidWakeState.Ticket captured=ticket;main.postDelayed(()->{if(active==captured&&state.phase()!=Phone11AndroidWakeState.Phase.ACTIVE)finish(true);},Math.max(1,expiry-now()));
      request("claim",captured,(response,revoked)->{
        if(revoked){revoke();return;}try{
          if(response==null||!Arrays.asList("pending","ready").contains(response.optString("status"))||!state.claimed(captured,Phone11WakeStore.binding(response),now()))throw new Phone11CallRuntime.Failure("E_WAKE_CLAIM");
          JSONObject sip=response.getJSONObject("sip");Map<String,Object> config=jsonMap(sip);String hash=fingerprint(config);
          Map<String,Object> snapshot=runtime.snapshot(lease);List<?> accounts=(List<?>)snapshot.get("accounts");
          if(Boolean.TRUE.equals(snapshot.get("initialized"))){if(accounts.size()!=1||!captured.bindingId.equals(foregroundBinding)||!hash.equals(accountHash))throw new Phone11CallRuntime.Failure("E_WAKE_OWNER");}
          else runtime.initialize(lease);
          adapter.setWakeCorrelation(captured.callUUID,captured.expiresAt);String account;
          if(accounts.isEmpty()){account=(String)runtime.createAccount(lease,config).get("id");accountHash=hash;}else account=(String)((Map<?,?>)accounts.get(0)).get("id");
          config.clear();runtime.register(lease,account,300);
        }catch(Exception failure){finish(true);}
      });
    }catch(RuntimeException failure){if(active!=null&&service==owner)finish(false);else owner.done();}
  }
  private interface Response{void done(JSONObject value,boolean revoked);}
  private void request(String operation,Phone11AndroidWakeState.Ticket ticket,Response response){JSONObject saved=enrollment;http.request(operation,saved,ticket,()->state.isCurrent(ticket,now()),(value,revoked)->{if(active!=ticket)return;response.done(value,revoked);});}
  private void poll(Phone11AndroidWakeState.Ticket ticket){if(active!=ticket)return;if(!state.isCurrent(ticket,now())){finish(true);return;}boolean connected=state.phase()==Phone11AndroidWakeState.Phase.ACTIVE;request(connected?"ready":"status",ticket,(value,revoked)->{if(revoked){revoke();return;}if(value!=null&&!Arrays.asList("pending","ready").contains(value.optString("status"))){finish(false);return;}main.postDelayed(()->poll(ticket),connected?20000:1000);});}
  void connection(Phone11ConnectionService.Call call,String uuid,String binding,long epoch){if(!matches(uuid,binding,epoch)){call.ended();return;}connection=call;if(state.phase()==Phone11AndroidWakeState.Phase.ACTIVE)call.setActive();else call.setRinging();}
  void answerFromBridge(String id){if(active==null||!Objects.equals(callId,id))throw new Phone11CallRuntime.Failure("E_CALL_STATE");answerRequested=true;accept();}
  void answer(String uuid,String binding,long epoch){if(!matches(uuid,binding,epoch)||!permissions())return;answerRequested=true;accept();}
  private boolean matches(String uuid,String binding,long epoch){return active!=null&&active.epoch==epoch&&active.callUUID.equals(uuid)&&active.bindingId.equals(binding)&&state.isCurrent(active,now());}
  private void accept(){if(!answerRequested||!serverReady||callId==null||active==null||state.phase()!=Phone11AndroidWakeState.Phase.RINGING)return;try{if(!permissions()||!service.microphone())throw new Phone11CallRuntime.Failure("E_MICROPHONE_PERMISSION");if(!state.answer(active,now()))throw new Phone11CallRuntime.Failure("E_WAKE_OWNER");runtime.answer(lease,callId);}catch(RuntimeException failure){finish(true);}}
  void end(String uuid,String binding,long epoch){if("local".equals(uuid)){endLocal(uuid,binding,epoch);return;}if(matches(uuid,binding,epoch))finish(true);}
  private void event(Map<String,Object> event){
    if(recordHistory&&active!=null&&enrollment!=null&&"callTerminated".equals(event.get("type"))&&event.get("call") instanceof Map){try{history.record(Phone11WakeStore.publicBinding(enrollment),active.callUUID,copyCall(event.get("call")));}catch(RuntimeException ignored){/* History failure never owns SIP teardown. */}}
    if(active!=null&&finishing&&"callTerminated".equals(event.get("type")))finish(false,true);
    if(active!=null&&!finishing){String type=(String)event.get("type");Map<?,?> call=event.get("call") instanceof Map?(Map<?,?>)event.get("call"):null;Phone11AndroidWakeState.Ticket ticket=active;
      if("registration".equals(type)){Map<?,?> account=(Map<?,?>)event.get("account");if("registered".equals(account.get("registrationState"))&&state.ready(ticket,now()))request("ready",ticket,(value,revoked)->{if(revoked){revoke();return;}if(value==null||!"ready".equals(value.optString("status"))){finish(true);return;}serverReady=true;Phone11ConnectionService.incoming(context,ticket);accept();poll(ticket);});else if("failed".equals(account.get("registrationState")))finish(true);}
      else if("callIncoming".equals(type)){callId=(String)call.get("id");if(!state.ringing(ticket,now())){finish(true);return;}accept();}
      else if("callConnected".equals(type)){if(!state.connected(ticket,now())){finish(true);return;}releaseWakeCpu();if(connection!=null)connection.setActive();if(service!=null)service.show(ticket.callUUID,ticket.bindingId,ticket.epoch,true);}
      else if("callTerminated".equals(type))finish(true,true);else if("error".equals(type))finish(true);
    }
    if(active==null&&"callTerminated".equals(event.get("type"))&&localService!=null)main.post(()->{List<?> calls=(List<?>)runtime.snapshot(lease).get("calls");for(Object value:calls){Map<?,?> c=(Map<?,?>)value;if(!"terminated".equals(c.get("state"))){localCallId=(String)c.get("id");return;}}localEnded();});
    if(bridge!=null)bridge.event(event);
  }
  private void finish(boolean notify){finish(notify,false);}
  private void finish(boolean notify,boolean terminated){if(active==null)return;if(finishing){if(terminated){final Phone11AndroidWakeState.Ticket ticket=active;main.post(()->finishNow(ticket,true));}return;}finishing=true;releaseWakeCpu();Phone11AndroidWakeState.Ticket ticket=active;JSONObject saved=enrollment;if(notify&&saved!=null)http.request("end",saved,ticket,()->true,(value,revoked)->{});state.end(ticket,now());adopted=answerRequested=serverReady=false;if(connection!=null){connection.ended();connection=null;}
    if(terminated){main.post(()->finishNow(ticket,true));return;}
    if(callId!=null){try{runtime.end(lease,callId);main.postDelayed(()->finishNow(ticket,false),5000);return;}catch(RuntimeException ignored){}}
    finishNow(ticket,false);
  }
  private void finishNow(Phone11AndroidWakeState.Ticket ticket,boolean terminated){if(active!=ticket)return;active=null;adapter.setWakeCorrelation(null,0);if(forceShutdown||!terminated||!bridgeAttached){try{runtime.destroy(lease);}catch(RuntimeException ignored){/* Retain quarantine for foreground cleanup. */}accountHash=foregroundBinding=null;}callId=null;enrollment=null;recordHistory=false;forceShutdown=false;if(service!=null){Phone11IncomingCallService value=service;service=null;value.done();}finishing=false;}
  private void releaseWakeCpu(){Phone11WakeCpuLock.get(context).release(wakeCpuOwner);wakeCpuOwner=null;}
  void serviceDestroyed(Phone11IncomingCallService value){if(service==value)finish(true);if(localService==value){localService=null;if(localCallId!=null){try{runtime.end(lease,localCallId);}catch(RuntimeException failure){try{runtime.destroy(lease);}catch(RuntimeException ignored){}}localCallId=null;}}}
  @SuppressWarnings("unchecked") private static Map<String,Object> copyCall(Object value){return new LinkedHashMap<>((Map<String,Object>)value);}
  static Map<String,Object> jsonMap(JSONObject value)throws Exception{Map<String,Object> result=new LinkedHashMap<>();Iterator<String> keys=value.keys();while(keys.hasNext()){String key=keys.next();Object item=value.get(key);if(item==JSONObject.NULL)throw new Exception();result.put(key,item);}return result;}
}
