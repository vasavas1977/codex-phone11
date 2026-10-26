package ai.phone11.siprix;
import java.util.*;

/** Command/callback contracts; this does not execute vendor native code. */
final class AndroidNativeCandidateTest {
  static int checks;
  static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
  static void fail(String code,Runnable task){try{task.run();throw new AssertionError("expected "+code);}catch(Phone11CallRuntime.Failure f){check(code.equals(f.code));}}
  static final String REQUEST="00000000-0000-0000-0000-000000000001";
  static class BaseEngine implements Phone11CallRuntime.Engine {
    Phone11CallRuntime.Listener listener;int account=7,call=11,invites,answers,ends,holds,mutes,dtmfs,destroys,rejectsVideo,holdState;
    String fail;boolean speaker,rejectAfterAnswerFailure,lastEndRejected;
    void command(String name){if(name.equals(fail))throw new Phone11CallRuntime.Failure("E_SIPRIX_-77");}
    public String initialize(Phone11CallRuntime.Listener l){command("initialize");listener=l;return "siprix 1.1.0 from 20260905_1222";}
    public void destroy(){command("destroy");destroys++;}
    public int addAccount(Map<String,Object> c){command("add");return account;}
    public void register(int id,int expiry){command("register");} public void unregister(int id){command("unregister");} public void delete(int id){command("delete");}
    public int invite(int acc,String destination){command("invite");invites++;return call;}
    public void answer(int id){command("answer");answers++;} public void end(int id,boolean reject){command("end");if(rejectAfterAnswerFailure&&answers>0&&reject)throw new Phone11CallRuntime.Failure("E_SIPRIX_-77");lastEndRejected=reject;ends++;}
    public void mute(int id,boolean v){command("mute");mutes++;} public void rejectVideo(int id){command("rejectVideo");rejectsVideo++;} public int holdState(int id){command("queryHold");return holdState;}
    public void toggleHold(int id){command("hold");holds++;} public void dtmf(int id,String digits){command("dtmf");dtmfs++;}
    public boolean speaker(){return speaker;} public void speaker(boolean v){command("speaker");speaker=v;}

  }
  static final class Engine extends BaseEngine {
    int transfers,registrations,adds;Integer inlineResult;boolean failCleanup,linkageInitialize,linkageDestroy;
    public String initialize(Phone11CallRuntime.Listener listener){if(linkageInitialize)throw new UnsatisfiedLinkError("synthetic");return super.initialize(listener);}
    public void register(int id,int expiry){super.register(id,expiry);registrations++;}
    public int addAccount(Map<String,Object> config){adds++;return super.addAccount(config);}
    public void transferBlind(int call,String destination){transfers++;if(inlineResult!=null)listener.transferred(call,inlineResult);command("transfer");}
    public void destroy(){if(linkageDestroy)throw new UnsatisfiedLinkError("synthetic");if(failCleanup)throw new Phone11CallRuntime.Failure("E_CLEANUP");super.destroy();}
  }
  static final class Fixture {
    final Engine e=new Engine();final List<Map<String,Object>> events=new ArrayList<>();final Phone11CallRuntime r;final long lease;
    Fixture(boolean enabled){r=new Phone11CallRuntime(e,events::add,false,null,enabled);lease=r.acquire();}
    void connected(){r.initialize(lease);r.createAccount(lease,new HashMap<>());r.register(lease,"7",300);e.listener.registration(7,0,"SIP/2.0 200 OK");r.invite(lease,"7","1020");e.listener.connected(11,false);}
    @SuppressWarnings("unchecked") Map<String,Object> call(){return ((List<Map<String,Object>>)r.snapshot(lease).get("calls")).get(0);}
    void transfer(){r.transfer(lease,"11","+1020",REQUEST);}
  }
  public static void main(String[] args){
    Fixture smoke=new Fixture(true);Map<String,Object> result=smoke.r.smoke(smoke.lease);check("siprix 1.1.0 from 20260905_1222".equals(result.get("sdkVersion")));check(Boolean.FALSE.equals(result.get("initialized")));check(smoke.e.adds==0&&smoke.e.registrations==0&&smoke.e.invites==0&&smoke.e.destroys==1);check(((List<?>)result.get("accounts")).isEmpty());smoke.r.initialize(smoke.lease);fail("E_SMOKE_STATE",()->smoke.r.smoke(smoke.lease));smoke.r.destroy(smoke.lease);
    Fixture failedSmoke=new Fixture(true);failedSmoke.e.fail="initialize";fail("E_SIPRIX_-77",()->failedSmoke.r.smoke(failedSmoke.lease));check(failedSmoke.e.destroys==1);check(Boolean.FALSE.equals(failedSmoke.r.snapshot(failedSmoke.lease).get("cleanupRequired")));check(failedSmoke.e.adds==0&&failedSmoke.e.registrations==0);
    failedSmoke.e.failCleanup=true;fail("E_CLEANUP",()->failedSmoke.r.smoke(failedSmoke.lease));check(Boolean.TRUE.equals(failedSmoke.r.snapshot(failedSmoke.lease).get("cleanupRequired")));fail("E_SMOKE_STATE",()->failedSmoke.r.smoke(failedSmoke.lease));
    Fixture missingNative=new Fixture(true);missingNative.e.linkageInitialize=true;fail("E_ANDROID_SDK_RUNTIME",()->missingNative.r.smoke(missingNative.lease));check(missingNative.e.destroys==1);check(Boolean.FALSE.equals(missingNative.r.snapshot(missingNative.lease).get("cleanupRequired")));missingNative.e.linkageDestroy=true;fail("E_ANDROID_SDK_RUNTIME",()->missingNative.r.smoke(missingNative.lease));check(Boolean.TRUE.equals(missingNative.r.snapshot(missingNative.lease).get("cleanupRequired")));
    Fixture off=new Fixture(false);off.connected();fail("E_UNSUPPORTED",off::transfer);check(off.e.transfers==0);
    Fixture f=new Fixture(true);f.connected();fail("E_STALE_BRIDGE",()->f.r.transfer(0,"11","1020",REQUEST));fail("E_INVALID_ARGUMENT",()->f.r.transfer(f.lease,"11","sip:1020@test",REQUEST));fail("E_INVALID_ARGUMENT",()->f.r.transfer(f.lease,"11","1020","x"));check(f.e.transfers==0&&!f.call().containsKey("transferAttempted"));
    f.transfer();check(f.e.transfers==1);check(Boolean.TRUE.equals(f.call().get("transferPending")));check(!f.call().containsKey("transferStatusCode"));fail("E_TRANSFER_ATTEMPTED",f::transfer);fail("E_TRANSFER_PENDING",()->f.r.hold(f.lease,"11",true));fail("E_TRANSFER_PENDING",()->f.r.dtmf(f.lease,"11","1"));
    f.e.listener.transferred(99,0);check(Boolean.TRUE.equals(f.call().get("transferPending")));f.e.listener.transferred(11,403);check(Boolean.FALSE.equals(f.call().get("transferPending")));check(Integer.valueOf(403).equals(f.call().get("transferStatusCode")));int count=f.events.size();f.e.listener.transferred(11,0);check(f.events.size()==count);fail("E_TRANSFER_ATTEMPTED",f::transfer);f.r.end(f.lease,"11");check(f.e.ends==1);
    Fixture rejected=new Fixture(true);rejected.connected();rejected.e.fail="transfer";rejected.e.inlineResult=0;fail("E_SIPRIX_-77",rejected::transfer);check(Boolean.FALSE.equals(rejected.call().get("transferPending")));check(!rejected.call().containsKey("transferStatusCode"));fail("E_TRANSFER_ATTEMPTED",rejected::transfer);rejected.e.listener.transferred(11,0);check(!rejected.call().containsKey("transferStatusCode"));
    Fixture inline=new Fixture(true);inline.connected();inline.e.inlineResult=0;inline.transfer();check(Boolean.FALSE.equals(inline.call().get("transferPending")));check(Integer.valueOf(0).equals(inline.call().get("transferStatusCode")));
    Fixture held=new Fixture(true);held.connected();held.e.holdState=1;fail("E_CALL_STATE",held::transfer);held.e.holdState=0;held.r.hold(held.lease,"11",true);fail("E_CALL_STATE",held::transfer);check(held.e.transfers==0);
    Fixture stale=new Fixture(true);stale.connected();stale.transfer();Phone11CallRuntime.Listener old=stale.e.listener;stale.r.destroy(stale.lease);stale.r.initialize(stale.lease);count=stale.events.size();old.transferred(11,0);check(stale.events.size()==count);stale.r.release(stale.lease);fail("E_STALE_BRIDGE",stale::transfer);
    Map<String,Object> numeric=new LinkedHashMap<>();numeric.put("sipServer","example.test");numeric.put("sipExtension","1020");numeric.put("sipPassword","test-only");numeric.put("transport","TLS");numeric.put("port",5061);numeric.put("secureMedia",1);String canonical=Phone11AndroidAccountIdentity.fingerprint(numeric);Map<String,Object> js=new LinkedHashMap<>(numeric);js.put("port",5061D);js.put("secureMedia",1D);js.put("sipAuthId","1020");js.put("displName","Private Display");js.put("iceEnabled",false);check(canonical.equals(Phone11AndroidAccountIdentity.fingerprint(js)));js.put("sipPassword","different");check(!canonical.equals(Phone11AndroidAccountIdentity.fingerprint(js)));js.put("sipPassword","test-only");js.put("sipProxy","proxy.test");check(!canonical.equals(Phone11AndroidAccountIdentity.fingerprint(js)));js.remove("sipProxy");js.put("verifyIncomingCall",false);check(!canonical.equals(Phone11AndroidAccountIdentity.fingerprint(js)));
    Phone11ForegroundTrial.requireSource(true,"ai.phone11.mobile.staging",true,true,true);fail("E_ANDROID_SOURCE_GATE",()->Phone11ForegroundTrial.requireSource(true,"ai.phone11.mobile.staging",true,true,false));fail("E_ANDROID_SOURCE_GATE",()->Phone11ForegroundTrial.requireSource(true,"ai.phone11.mobile.androidcandidate",true,true,true));
    Phone11ForegroundTrial.requireSource(true,"ai.phone11.mobile.androidcandidate",true,true);fail("E_ANDROID_SOURCE_GATE",()->Phone11ForegroundTrial.requireSource(true,"ai.phone11.mobile.foregroundtrial",true,true));fail("E_ANDROID_SOURCE_GATE",()->Phone11ForegroundTrial.requireSource(true,"ai.phone11.mobile.androidcandidate",true,false));check(Boolean.TRUE.equals(Phone11ForegroundTrial.capabilities(false,true).get("transfer")));check(Boolean.FALSE.equals(Phone11ForegroundTrial.capabilities(false).get("transfer")));
    System.out.println("PASS "+checks+" native candidate assertions; no vendor execution, SIP or device acceptance");
  }
}
