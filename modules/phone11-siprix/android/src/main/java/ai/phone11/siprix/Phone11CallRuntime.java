package ai.phone11.siprix;

import java.util.*;
import java.util.regex.*;

/** Main-thread-only state owner. SDK acceptance never synthesizes connection or registration. */
public final class Phone11CallRuntime {
  public interface Engine {
    String initialize(Listener listener); void destroy();
    int addAccount(Map<String,Object> config); void register(int id,int expiry); void unregister(int id); void delete(int id);
    int invite(int account,String destination); void answer(int id); void end(int id,boolean reject);
    void mute(int id,boolean value); void rejectVideo(int id); int holdState(int id); void toggleHold(int id); void dtmf(int id,String digits);
    boolean speaker(); void speaker(boolean value);
  }
  public interface Listener {
    void registration(int account,int state,String response); void incoming(int call,int account,boolean video,String from);
    void proceeding(int call); void connected(int call,boolean video); void terminated(int call,int status);
    void held(int call,int state); void videoUpgrade(int call); void error(String operation,int code); void audio(); void trial(); void network(int state); void dtmf(int call,int tone);
  }
  public interface Sink { void event(Map<String,Object> value); }
  public static final class Failure extends RuntimeException {
    private static final long serialVersionUID=1L;
    public final String code;
    public Failure(String code){super(code);this.code=code;}
  }
  private final Engine engine; private final Sink sink;
  private long nextLease=0,owner=0,generation=0,sequence=0;
  private boolean initialized=false,quarantined=false,accountRetired=false,trial=false,wantsRegistration=false;
  private String sdkVersion; private Map<String,Object> account; private Map<String,Object> call;
  private final Set<Integer> retiredCalls=new HashSet<>();
  private boolean answerPending=false,endPending=false,holdPending=false,requestedLocalHold=false;
  public Phone11CallRuntime(Engine engine,Sink sink){this.engine=engine;this.sink=sink;}
  public long acquire(){if(owner!=0)return 0;return owner=++nextLease;}
  public void requireOwner(long lease){if(lease==0||lease!=owner)throw new Failure("E_STALE_BRIDGE");}
  public void release(long lease){if(lease==0||lease!=owner)return;try{destroy(lease);}finally{owner=0;}}
  private void ready(long lease){requireOwner(lease);if(quarantined)throw new Failure("E_CLEANUP_REQUIRED");if(!initialized)throw new Failure("E_NOT_INITIALIZED");}
  private int account(long lease,String id){ready(lease);int n=id(id);if(account==null||!id.equals(account.get("id")))throw new Failure("E_ACCOUNT_STATE");return n;}
  private int call(long lease,String id){ready(lease);int n=id(id);if(call==null||!id.equals(call.get("id")))throw new Failure("E_CALL_STATE");return n;}
  private static int id(String value){try{int n=Integer.parseInt(value);if(n<=0||!Integer.toString(n).equals(value))throw new Exception();return n;}catch(Exception e){throw new Failure("E_INVALID_ARGUMENT");}}
  private void idle(){if(call!=null)throw new Failure("E_ACTIVE_CALL");}
  private void connectedControl(){if(endPending||!("connected".equals(call.get("state"))||"held".equals(call.get("state"))))throw new Failure("E_CALL_STATE");}
  public Map<String,Object> initialize(long lease){
    requireOwner(lease);if(quarantined)throw new Failure("E_CLEANUP_REQUIRED");if(initialized)return snapshot(lease);
    final long captured=++generation;sequence=0;
    try{sdkVersion=engine.initialize(listener(captured));initialized=true;}catch(RuntimeException failure){quarantined=true;throw failure;}
    return snapshot(lease);
  }
  public void destroy(long lease){
    requireOwner(lease);if(!initialized&&!quarantined)return;
    try{engine.destroy();}catch(RuntimeException failure){quarantined=true;throw failure;}
    initialized=false;quarantined=false;++generation;sequence=0;sdkVersion=null;account=null;call=null;
    accountRetired=false;retiredCalls.clear();answerPending=endPending=holdPending=requestedLocalHold=false;trial=false;wantsRegistration=false;
  }
  public Map<String,Object> snapshot(long lease){requireOwner(lease);return map("initialized",initialized,"cleanupRequired",quarantined,
    "generation",generation,"sequence",sequence,"sdkVersion",sdkVersion,"accounts",account==null?new ArrayList<>():Arrays.asList(copy(account)),
    "calls",call==null?new ArrayList<>():Arrays.asList(copy(call)),"audioSessionActive",false,
    "speaker",initialized&&!quarantined&&engine.speaker(),"trialNotified",trial,"warmTransferAvailable",false);}
  public Map<String,Object> createAccount(long lease,Map<String,Object> config){
    ready(lease);idle();if(account!=null||accountRetired)throw new Failure("E_ACCOUNT_REINITIALIZE");
    int n=engine.addAccount(config);if(n<=0){quarantined=true;throw new Failure("E_INVALID_SDK_ID");}
    account=map("id",Integer.toString(n),"accountId",Integer.toString(n),"registrationState","unregistered");return copy(account);
  }
  public void register(long lease,String id,int expiry){int n=account(lease,id);idle();if(expiry<1||expiry>86400)throw new Failure("E_INVALID_ARGUMENT");engine.register(n,expiry);wantsRegistration=true;account.put("registrationState","registering");account.remove("regState");account.remove("sipStatusCode");}
  public void unregister(long lease,String id){int n=account(lease,id);idle();engine.unregister(n);wantsRegistration=false;account.put("registrationState","unregistered");}
  public void delete(long lease,String id){int n=account(lease,id);idle();engine.delete(n);account=null;accountRetired=true;wantsRegistration=false;}
  public Map<String,Object> invite(long lease,String accountId,String destination){
    int acc=account(lease,accountId);idle();if(!"registered".equals(account.get("registrationState"))||!wantsRegistration)throw new Failure("E_NOT_REGISTERED");
    if(destination==null||!destination.matches("(?i)(?:sips?:)?[+a-z0-9_.!-]+(?:@[a-z0-9.-]+(?::[0-9]{1,5})?)?"))throw new Failure("E_INVALID_ARGUMENT");
    int n=engine.invite(acc,destination);if(n<=0||retiredCalls.contains(n)){quarantined=true;throw new Failure("E_CALL_ID_REUSED");}
    call=newCall(n,acc,"outgoing",destination,"dialing");return copy(call);
  }
  public void answer(long lease,String id){int n=call(lease,id);if(endPending)throw new Failure("E_CALL_STATE");if(answerPending||"connected".equals(call.get("state")))return;
    if(!"incoming".equals(call.get("direction"))||!"ringing".equals(call.get("state")))throw new Failure("E_CALL_STATE");engine.answer(n);answerPending=true;}
  public void end(long lease,String id){int n=call(lease,id);if(endPending)return;engine.end(n,!answerPending&&"incoming".equals(call.get("direction"))&&"ringing".equals(call.get("state")));endPending=true;}
  public void mute(long lease,String id,boolean muted){int n=call(lease,id);connectedControl();engine.mute(n,muted);call.put("muted",muted);emit("callMuted","call",copy(call));}
  public void hold(long lease,String id,boolean held){int n=call(lease,id);connectedControl();if(holdPending)throw new Failure("E_HOLD_PENDING");
    int state=engine.holdState(n);if(state<0||state>3)throw new Failure("E_INVALID_HOLD_STATE");if(((state&1)!=0)==held)return;engine.toggleHold(n);requestedLocalHold=held;holdPending=true;}
  public void dtmf(long lease,String id,String digits){int n=call(lease,id);connectedControl();if(digits==null||!digits.matches("[0-9*#A-D]{1,32}"))throw new Failure("E_INVALID_ARGUMENT");engine.dtmf(n,digits);}
  public void speaker(long lease,boolean enabled){ready(lease);if(call==null)throw new Failure("E_CALL_STATE");engine.speaker(enabled);}
  private boolean current(long captured){return initialized&&!quarantined&&captured==generation;}
  private boolean ownsCall(int n){return call!=null&&Integer.toString(n).equals(call.get("id"));}
  private void emit(String type,String key,Object value){Map<String,Object> event=map("type",type,"generation",generation,"sequence",++sequence);if(key!=null)event.put(key,value);sink.event(event);}
  private void errorEvent(String operation,RuntimeException failure){int code=-1;if(failure instanceof Failure&&((Failure)failure).code.startsWith("E_SIPRIX_")){try{code=Integer.parseInt(((Failure)failure).code.substring(9));}catch(NumberFormatException ignored){}}Map<String,Object> event=map("type","error","generation",generation,"sequence",++sequence,"operation",operation,"code",code);sink.event(event);}
  private void changed(String type,String state){call.put("state",state);emit(type,"call",copy(call));}
  public Listener listener(final long captured){return new Listener(){
    public void registration(int n,int state,String response){if(!current(captured)||account==null||!Integer.toString(n).equals(account.get("id")))return;
      if(state==0&&!wantsRegistration)return;
      account.put("regState",state);account.put("registrationState",state==0?"registered":state==1?"failed":state==3?"registering":"unregistered");
      account.remove("sipStatusCode");Matcher m=Pattern.compile("^SIP/2\\.0 ([1-6][0-9]{2})(?:[ \\t]|$)").matcher(response==null?"":response);
      if(m.find())account.put("sipStatusCode",Integer.parseInt(m.group(1)));emit("registration","account",copy(account));}
    public void incoming(int n,int acc,boolean video,String from){if(!current(captured))return;if(ownsCall(n))return;
      if(n<=0||retiredCalls.contains(n)||call!=null||account==null||!Integer.toString(acc).equals(account.get("id"))||!wantsRegistration){
        try{engine.end(n,true);}catch(RuntimeException failure){quarantined=true;errorEvent("rejectIncoming",failure);}if(n>0)retiredCalls.add(n);return;}
      call=newCall(n,acc,"incoming",safeUri(from),"ringing");call.put("videoOffered",video);emit("callIncoming","call",copy(call));}
    public void proceeding(int n){if(current(captured)&&ownsCall(n)&&!endPending&&("dialing".equals(call.get("state"))||"proceeding".equals(call.get("state"))))changed("callProceeding","proceeding");}
    public void connected(int n,boolean video){if(!current(captured)||!ownsCall(n)||endPending)return;
      if(video){try{engine.end(n,false);endPending=true;}catch(RuntimeException failure){quarantined=true;}errorEvent("unexpectedVideo",new Failure("E_UNSUPPORTED"));return;}
      if(Boolean.TRUE.equals(call.get("answered")))return;answerPending=false;call.put("answered",true);call.put("answeredAt",System.currentTimeMillis());changed("callConnected","connected");}
    public void terminated(int n,int status){if(!current(captured)||!ownsCall(n))return;call.put("statusCode",status);changed("callTerminated","terminated");retiredCalls.add(n);call=null;answerPending=endPending=holdPending=false;}
    public void held(int n,int state){if(!current(captured)||!ownsCall(n)||endPending||!Boolean.TRUE.equals(call.get("answered"))||state<0||state>3)return;
      if(holdPending&&((state&1)!=0)==requestedLocalHold)holdPending=false;call.put("holdState",state);call.put("held",state!=0);changed("callHeld",state==0?"connected":"held");}
    public void videoUpgrade(int n){if(!current(captured)||!ownsCall(n)||endPending)return;try{engine.rejectVideo(n);}catch(RuntimeException failure){errorEvent("rejectVideoUpgrade",failure);}}
    public void error(String operation,int code){if(current(captured))errorEvent(operation,new Failure("E_SIPRIX_"+code));}
    public void audio(){if(current(captured)){Map<String,Object> event=map("type","devicesAudioChanged","generation",generation,"sequence",++sequence,"speaker",engine.speaker(),"audioSessionActive",false);sink.event(event);}}
    public void trial(){if(current(captured)){trial=true;emit("trial",null,null);}}
    public void network(int state){if(current(captured))emit("network","networkState",state);}
    public void dtmf(int n,int tone){if(current(captured)&&ownsCall(n)){Map<String,Object> event=map("type","dtmf","generation",generation,"sequence",++sequence,"callId",Integer.toString(n),"tone",tone);sink.event(event);}}
  };}
  private static Map<String,Object> newCall(int n,int acc,String direction,String remote,String state){return map("id",Integer.toString(n),"callId",Integer.toString(n),"accountId",Integer.toString(acc),"direction",direction,"state",state,
    "remoteUri",remote,"hasVideo",false,"muted",false,"held",false,"holdState",0,"historyId",UUID.randomUUID().toString(),"startedAt",System.currentTimeMillis());}
  static String safeUri(String value){if(value==null)return "";String candidate=value.trim();int open=candidate.indexOf('<'),close=candidate.indexOf('>');
    if(open>=0&&close>open)candidate=candidate.substring(open+1,close);candidate=candidate.split("[;?\\s]",2)[0];
    return candidate.matches("(?i)(?:sips?:)?[+a-z0-9_.!-]+@[a-z0-9.-]+(?::[0-9]{1,5})?")?candidate:"";}

  static Map<String,Object> map(Object... values){Map<String,Object> result=new LinkedHashMap<>();for(int i=0;i<values.length;i+=2)result.put((String)values[i],values[i+1]);return result;}
  private static Map<String,Object> copy(Map<String,Object> value){Map<String,Object> result=new LinkedHashMap<>(value);result.remove("answered");return result;}
}
