package ai.phone11.siprix;

import java.util.*;

/** Main-thread-only, one attempt per original lifetime. No OS/audio-session ownership. */
final class Phone11ConsultationRuntime {
  interface Scheduler { void after(long milliseconds,Runnable task); }
  interface Host {
    boolean current(Map<String,Object> original);
    boolean registered(); boolean retired(int id);
    Map<String,Object> newCall(int id,int account,String destination);
    void emit(String type,Map<String,Object> call); void retire(int id);
    void quarantine(RuntimeException failure);
  }
  private final Phone11CallRuntime.Engine engine; private final Host host; private final Scheduler scheduler;
  private Map<String,Object> original,consult;
  private boolean holdPending,holdAccepted,holdSeen,holdWanted,focusAccepted,focusSeen,consultEnding,endingOriginal;
  private boolean consultTerminated=false;
  private boolean transferAccepted; private Integer transferResult;
  private long timer=0;
  Phone11ConsultationRuntime(Phone11CallRuntime.Engine engine,Host host,Scheduler scheduler){this.engine=engine;this.host=host;this.scheduler=scheduler;}
  Map<String,Object> consult(){return consult;}
  void reset(){++timer;original=consult=null;holdPending=focusAccepted=focusSeen=consultEnding=endingOriginal=transferAccepted=false;transferResult=null;consultTerminated=false;}
  private boolean live(){return original!=null&&host.current(original);}
  private String phase(){return original==null?"":(String)original.get("consultationPhase");}
  private int number(Map<String,Object> call){return Integer.parseInt((String)call.get("id"));}
  private int hold(Map<String,Object> call){return ((Number)call.get("holdState")).intValue();}
  private void fail(String code){throw new Phone11CallRuntime.Failure(code);}
  private void require(String id,String request){if(!live()||!id.equals(original.get("id"))||!request.equals(original.get("consultationRequestId")))fail("E_CONSULTATION_CHANGED");}
  private static void uuid(String value){if(value==null||!value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");}
  private void changed(String value){original.put("consultationPhase",value);host.emit("consultationChanged",original);}
  private void later(long milliseconds,Runnable task){final long token=++timer;final Map<String,Object> captured=original;scheduler.after(milliseconds,()->{
    if(token!=timer||captured!=original||!live())return;
    try{task.run();}catch(RuntimeException failure){host.quarantine(failure);}
  });}
  void begin(Map<String,Object> call,String destination,String request,boolean pendingHold){
    uuid(request);
    if(destination==null||!destination.matches("[0-9*#]{1,32}"))fail("E_INVALID_ARGUMENT");
    if(consult!=null||!host.current(call)||!host.registered()||pendingHold||!"connected".equals(call.get("state"))||hold(call)!=0||Boolean.TRUE.equals(call.get("consultationAttempted"))||Boolean.TRUE.equals(call.get("transferAttempted")))fail("E_CALL_STATE");
    original=call;endingOriginal=false;consultTerminated=false;original.put("consultationAttempted",true);original.put("consultationRequestId",request);original.put("consultationDestination",destination);
    // Reserve before SDK command: even an inline callback cannot synthesize acceptance.
    changed("holding");
    try{if(engine.holdState(number(original))!=0)fail("E_CALL_STATE");requestHold(true);}catch(RuntimeException failure){holdPending=false;changed("consultation_failed");throw failure;}
  }
  private void requestHold(boolean wanted){
    holdPending=true;holdWanted=wanted;holdAccepted=false;holdSeen=false;
    later(30000,()->{changed("return_failed");}); // A late confirmed hold may still enable safe cancellation.
    try{engine.toggleHold(number(original));holdAccepted=true;if(holdSeen)heldProgress();}
    catch(RuntimeException failure){holdPending=false;++timer;throw failure;}
  }
  void continueCall(String id,String request){
    require(id,request);
    if(!"held_ready".equals(phase())||holdPending||consult!=null||!host.registered()||hold(original)!=1||engine.holdState(number(original))!=1)fail("E_CALL_STATE");
    changed("calling");
    int n;
    try{n=engine.invite(numberAccount(),(String)original.get("consultationDestination"));}
    catch(RuntimeException failure){changed("consultation_failed");returnOriginal();throw failure;}
    if(n<=0||n==number(original)||host.retired(n)){host.quarantine(new Phone11CallRuntime.Failure("E_CALL_ID_REUSED"));fail("E_CALL_ID_REUSED");}
    consult=host.newCall(n,numberAccount(),(String)original.get("consultationDestination"));consultEnding=false;
    consult.put("consultationParentId",original.get("id"));consult.put("consultationRequestId",request);original.put("consultationCallId",consult.get("id"));
    try{engine.mute(n,true);consult.put("muted",true);}
    catch(RuntimeException failure){host.emit("consultationChanged",original);host.emit("consultationChanged",consult);abortConsult();throw failure;}
    host.emit("consultationChanged",original); // Parent admission must precede second-leg introduction.
    host.emit("consultationChanged",consult);
    later(35000,()->{if("calling".equals(phase())||"switching".equals(phase()))abortConsult();});
  }
  private int numberAccount(){return Integer.parseInt((String)original.get("accountId"));}
  void cancel(String id,String request){
    require(id,request);
    if(Boolean.TRUE.equals(original.get("transferPending"))||"completed".equals(phase()))fail("E_TRANSFER_PENDING");
    if("returned".equals(phase()))return;
    changed("canceling");
    if(consult!=null)endConsult();else returnOriginal();
  }
  private void endConsult(){
    if(consult==null||consultEnding)return;
    consultEnding=true;
    try{engine.end(number(consult),false);}catch(RuntimeException failure){host.quarantine(failure);throw failure;}
    later(30000,()->changed("return_failed")); // Never restore while termination is unconfirmed.
  }
  private void abortConsult(){if(!live())return;changed("consultation_failed");if(consult!=null){changed("canceling");endConsult();}else returnOriginal();}
  private void returnOriginal(){
    if(!live()||consult!=null||endingOriginal||Boolean.TRUE.equals(original.get("transferPending"))||"completed".equals(phase()))return;
    if(holdPending){changed("canceling");return;}
    int state=engine.holdState(number(original));if(state<0||state>3)fail("E_INVALID_HOLD_STATE");
    if((state&1)!=0){changed("returning");try{requestHold(false);}catch(RuntimeException failure){changed("return_failed");throw failure;}}
    else{original.put("holdState",state);original.put("held",state!=0);original.put("state",state==0?"connected":"held");focus(true);}
  }
  private void focus(boolean returning){
    focusAccepted=focusSeen=false;changed(returning?"restoring_audio":"switching");
    final int id=number(returning?original:consult);
    later(5000,()->{if(returning)changed("return_failed");else abortConsult();});
    try{engine.switchCall(id);focusAccepted=true;focusProgress();}
    catch(RuntimeException failure){
      // The pinned SDK documents automatic return focus. -1047 confirms only
      // idempotent state; it never supplies the mandatory fresh callback.
      if(returning&&consultTerminated&&failure instanceof Phone11CallRuntime.Failure&&"E_SIPRIX_-1047".equals(((Phone11CallRuntime.Failure)failure).code)&&live()&&consult==null&&(hold(original)&1)==0){
        int state=engine.holdState(number(original));
        if(state>=0&&state<=3&&(state&1)==0){focusAccepted=true;focusProgress();return;}
      }
      if(returning)changed("return_failed");else abortConsult();throw failure;
    }
  }
  private void focusProgress(){
    if(!live()||!focusAccepted||!focusSeen)return;
    if("restoring_audio".equals(phase())&&consult==null&&(hold(original)&1)==0){
      int state=engine.holdState(number(original));
      if(state<0||state>3||(state&1)!=0){changed("return_failed");return;}
      ++timer;changed("returned");
    }
    else if("switching".equals(phase())&&consult!=null&&!consultEnding&&"connected".equals(consult.get("state"))&&hold(original)==1){
      if(engine.holdState(number(original))!=1||engine.holdState(number(consult))!=0){abortConsult();return;}
      if(!Objects.equals(consult.get("muted"),original.get("muted")))engine.mute(number(consult),Boolean.TRUE.equals(original.get("muted")));consult.put("muted",original.get("muted"));host.emit("callMuted",consult);++timer;changed("ready");
    }
  }
  void complete(String id,String request,String transferRequest){
    require(id,request);uuid(transferRequest);
    if(!"ready".equals(phase())||consult==null||consultEnding||endingOriginal||holdPending||hold(original)!=1||hold(consult)!=0||!"connected".equals(consult.get("state"))||Boolean.TRUE.equals(original.get("transferAttempted"))||engine.holdState(number(original))!=1||engine.holdState(number(consult))!=0)fail("E_CALL_STATE");
    original.put("transferAttempted",true);original.put("transferRequestId",transferRequest);original.put("transferPending",true);original.remove("transferStatusCode");transferAccepted=false;transferResult=null;changed("transferring");
    later(30000,()->changed("transfer_failed")); // Timeout is uncertainty, not an SDK transfer outcome. Keep the in-flight fence.
    try{engine.transferAttended(number(original),number(consult));transferAccepted=true;transferProgress();}
    catch(RuntimeException failure){++timer;original.put("transferPending",false);changed("transfer_failed");transferResult=null;throw failure;}
  }
  private void transferProgress(){
    if(!live()||!transferAccepted||transferResult==null||!Boolean.TRUE.equals(original.get("transferPending")))return;
    ++timer;original.put("transferPending",false);original.put("transferStatusCode",transferResult);changed(transferResult==0?"completed":"transfer_failed");host.emit("callTransferred",original);transferResult=null;
  }
  void transferred(int id,int status){if(live()&&id==number(original)&&("transferring".equals(phase())||"transfer_failed".equals(phase()))&&Boolean.TRUE.equals(original.get("transferPending"))&&transferResult==null){transferResult=status;transferProgress();}}
  void held(int id,int state){
    if(!live()||id!=number(original))return;
    if(holdPending&&((state&1)!=0)==holdWanted){holdSeen=true;if(holdAccepted)heldProgress();}
    else if(("ready".equals(phase())||"switching".equals(phase())||"calling".equals(phase())||"held_ready".equals(phase()))&&state!=1)abortConsult();
  }
  private void heldProgress(){
    holdPending=false;++timer;
    if("holding".equals(phase())&&hold(original)==1){changed("held_ready");later(30000,()->cancel((String)original.get("id"),(String)original.get("consultationRequestId")));}
    else if("returning".equals(phase())||( "canceling".equals(phase())||"return_failed".equals(phase()))){returnOriginal();}
    else if("holding".equals(phase()))abortConsult();
  }
  void switched(int id){
    if(!live())return;
    if(("switching".equals(phase())&&consult!=null&&id==number(consult))||("restoring_audio".equals(phase())&&consult==null&&id==number(original))){focusSeen=true;focusProgress();}
    else if("ready".equals(phase())&&consult!=null&&id!=number(consult)){engine.mute(number(consult),true);consult.put("muted",true);host.emit("callMuted",consult);abortConsult();}
  }
  boolean owns(int id){return consult!=null&&id==number(consult);}
  void consultHeld(int state){if(consult==null||consultEnding||!consult.containsKey("answeredAt")||state<0||state>3)return;consult.put("holdState",state);consult.put("held",state!=0);consult.put("state",state==0?"connected":"held");host.emit("callHeld",consult);if(state!=0&&live()&&!consultEnding&&!"transferring".equals(phase()))abortConsult();}
  boolean proceeding(int id){if(!owns(id))return false;if(!consultEnding&&"dialing".equals(consult.get("state"))){consult.put("state","proceeding");host.emit("callProceeding",consult);}return true;}
  boolean connected(int id,boolean video){
    if(!owns(id))return false;
    if(video){abortConsult();return true;}
    if(consultEnding||!live()||!"calling".equals(phase()))return true;
    consult.put("state","connected");consult.put("answeredAt",System.currentTimeMillis());host.emit("callConnected",consult);focus(false);return true;
  }
  boolean terminated(int id,int status){
    if(!owns(id))return false;
    consult.put("state","terminated");consult.put("statusCode",status);host.emit("callTerminated",consult);host.retire(id);consultTerminated=true;consult=null;consultEnding=false;if(!live()||!Boolean.TRUE.equals(original.get("transferPending")))++timer;
    if(live()&&!Boolean.TRUE.equals(original.get("transferPending"))&&!"completed".equals(phase()))returnOriginal();
    return true;
  }
  void originalTerminated(){
    ++timer;
    if(consult!=null&&!"completed".equals(phase())&&!"transferring".equals(phase()))endConsult();
  }
  void endOriginal(){endingOriginal=true;++timer;if(consult!=null)endConsult();}
  void endConsultById(){if(live())cancel((String)original.get("id"),(String)original.get("consultationRequestId"));else{consultEnding=true;try{engine.end(number(consult),false);}catch(RuntimeException failure){host.quarantine(failure);throw failure;}}}
  boolean muteOriginal(String id,boolean value){
    if(!live()||!id.equals(original.get("id"))||!busy())return false;
    if(Boolean.TRUE.equals(original.get("transferPending"))||"completed".equals(phase()))fail("E_TRANSFER_PENDING");
    try{
      if(!Objects.equals(original.get("muted"),value))engine.mute(number(original),value);
      original.put("muted",value);host.emit("callMuted",original);
      // During setup the consultation stays muted; only confirmed focus can unmute it.
      if("ready".equals(phase())&&consult!=null&&!consultEnding){
        if(!Objects.equals(consult.get("muted"),value))engine.mute(number(consult),value);
        consult.put("muted",value);host.emit("callMuted",consult);
      }
    }catch(RuntimeException failure){host.quarantine(failure);throw failure;}
    return true;
  }
  boolean busy(){return live()&&!Arrays.asList("returned","consultation_failed").contains(phase());}
}
