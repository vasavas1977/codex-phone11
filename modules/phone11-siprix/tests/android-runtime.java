package ai.phone11.siprix;
import java.util.*;

/** Injected command-boundary tests, not SDK execution, SIP traffic, or device acceptance. */
final class AndroidRuntimeTest {
  static int assertions;
  static void check(boolean value){assertions++;if(!value)throw new AssertionError("assertion "+assertions);}
  static void fails(String code,Runnable action){try{action.run();throw new AssertionError("expected "+code);}catch(Phone11CallRuntime.Failure failure){check(code.equals(failure.code));}}
  static class Engine implements Phone11CallRuntime.Engine {
    Phone11CallRuntime.Listener listener;int account=7,call=11,invites,answers,ends,holds,mutes,dtmfs,destroys,rejectsVideo,holdState;
    String fail;boolean speaker,rejectAfterAnswerFailure,lastEndRejected;
    void command(String name){if(name.equals(fail))throw new Phone11CallRuntime.Failure("E_SIPRIX_-77");}
    public String initialize(Phone11CallRuntime.Listener l){command("initialize");listener=l;return "1.1.0 from 20260905_1222";}
    public void destroy(){command("destroy");destroys++;}
    public int addAccount(Map<String,Object> c){command("add");return account;}
    public void register(int id,int expiry){command("register");} public void unregister(int id){command("unregister");} public void delete(int id){command("delete");}
    public int invite(int acc,String destination){command("invite");invites++;return call;}
    public void answer(int id){command("answer");answers++;} public void end(int id,boolean reject){command("end");if(rejectAfterAnswerFailure&&answers>0&&reject)throw new Phone11CallRuntime.Failure("E_SIPRIX_-77");lastEndRejected=reject;ends++;}
    public void mute(int id,boolean v){command("mute");mutes++;} public void rejectVideo(int id){command("rejectVideo");rejectsVideo++;} public int holdState(int id){command("queryHold");return holdState;}
    public void toggleHold(int id){command("hold");holds++;} public void dtmf(int id,String digits){command("dtmf");dtmfs++;}
    public boolean speaker(){return speaker;} public void speaker(boolean v){command("speaker");speaker=v;}
  }
  static class Fixture {Engine e=new Engine();List<Map<String,Object>> events=new ArrayList<>();Phone11CallRuntime r=new Phone11CallRuntime(e,events::add);long lease=r.acquire();
    Fixture(){r.initialize(lease);r.createAccount(lease,new HashMap<>());r.register(lease,"7",300);e.listener.registration(7,0,"SIP/2.0 200 OK");}
    void invite(){r.invite(lease,"7","sip:1020@example.test");}
    void connect(){e.listener.connected(11,false);}
  }
  @SuppressWarnings("unchecked") static Map<String,Object> call(Fixture f){return ((List<Map<String,Object>>)f.r.snapshot(f.lease).get("calls")).get(0);}
  public static void main(String[] args){
    Engine e=new Engine();List<Map<String,Object>> events=new ArrayList<>();Phone11CallRuntime r=new Phone11CallRuntime(e,events::add);long lease=r.acquire();
    check(r.acquire()==0);fails("E_STALE_BRIDGE",()->r.initialize(0));check(Boolean.FALSE.equals(r.snapshot(lease).get("initialized")));
    r.initialize(lease);long generation=((Number)r.snapshot(lease).get("generation")).longValue();r.initialize(lease);check(generation==((Number)r.snapshot(lease).get("generation")).longValue());
    r.createAccount(lease,new HashMap<>());fails("E_ACCOUNT_REINITIALIZE",()->r.createAccount(lease,new HashMap<>()));
    fails("E_NOT_REGISTERED",()->r.invite(lease,"7","1020"));r.register(lease,"7",300);fails("E_NOT_REGISTERED",()->r.invite(lease,"7","1020"));
    e.listener.registration(7,0,"SIP/2.0 200 credential-bearing text");check(events.get(0).toString().contains("sipStatusCode=200"));check(!events.toString().contains("credential"));
    r.unregister(lease,"7");e.listener.registration(7,0,"SIP/2.0 200 OK");fails("E_NOT_REGISTERED",()->r.invite(lease,"7","1020"));
    r.delete(lease,"7");fails("E_ACCOUNT_REINITIALIZE",()->r.createAccount(lease,new HashMap<>()));Phone11CallRuntime.Listener old=e.listener;
    r.destroy(lease);r.initialize(lease);old.incoming(11,7,false,"sip:100@example.test");check(((List<?>)r.snapshot(lease).get("calls")).isEmpty());
    r.release(lease);fails("E_STALE_BRIDGE",()->r.snapshot(lease));check(r.acquire()>lease);
    Fixture f=new Fixture();f.invite();check("dialing".equals(call(f).get("state")));check(f.events.size()==1);fails("E_ACTIVE_CALL",()->f.invite());check(f.e.invites==1);
    fails("E_ACTIVE_CALL",()->f.r.unregister(f.lease,"7"));fails("E_ACTIVE_CALL",()->f.r.delete(f.lease,"7"));fails("E_INVALID_ARGUMENT",()->f.r.end(f.lease,"011"));
    fails("E_CALL_STATE",()->f.r.mute(f.lease,"11",true));f.e.listener.proceeding(11);check("proceeding".equals(call(f).get("state")));f.connect();check("connected".equals(call(f).get("state")));check(Boolean.FALSE.equals(call(f).get("hasVideo")));
    int count=f.events.size();f.connect();f.e.listener.proceeding(11);check(f.events.size()==count);check("connected".equals(call(f).get("state")));f.e.listener.videoUpgrade(99);check(f.e.rejectsVideo==0);f.e.listener.videoUpgrade(11);check(f.e.rejectsVideo==1);
    f.e.fail="mute";fails("E_SIPRIX_-77",()->f.r.mute(f.lease,"11",true));check(Boolean.FALSE.equals(call(f).get("muted")));f.e.fail=null;f.r.mute(f.lease,"11",true);check(Boolean.TRUE.equals(call(f).get("muted")));
    f.e.holdState=2;f.r.hold(f.lease,"11",true);check(f.e.holds==1);check(Boolean.FALSE.equals(call(f).get("held")));fails("E_HOLD_PENDING",()->f.r.hold(f.lease,"11",false));
    f.e.listener.held(11,2);check(((Number)call(f).get("holdState")).intValue()==2);fails("E_HOLD_PENDING",()->f.r.hold(f.lease,"11",false));
    f.e.listener.held(11,0);check("connected".equals(call(f).get("state")));fails("E_HOLD_PENDING",()->f.r.hold(f.lease,"11",true));check(f.e.holds==1);
    f.e.holdState=3;f.e.listener.held(11,3);check(Boolean.TRUE.equals(call(f).get("held")));check("held".equals(call(f).get("state")));f.r.hold(f.lease,"11",true);check(f.e.holds==1);
    f.r.hold(f.lease,"11",false);f.e.listener.held(11,2);check(Boolean.TRUE.equals(call(f).get("held")));check(((Number)call(f).get("holdState")).intValue()==2);
    fails("E_INVALID_ARGUMENT",()->f.r.dtmf(f.lease,"11","1;secret"));f.r.dtmf(f.lease,"11","12#");check(f.e.dtmfs==1);
    f.e.fail="end";fails("E_SIPRIX_-77",()->f.r.end(f.lease,"11"));check("held".equals(call(f).get("state")));f.e.fail=null;f.r.end(f.lease,"11");f.r.end(f.lease,"11");check(f.e.ends==1);
    fails("E_CALL_STATE",()->f.r.hold(f.lease,"11",false));f.e.listener.connected(11,false);f.e.listener.held(11,0);check("held".equals(call(f).get("state")));
    f.e.listener.terminated(11,200);check(((List<?>)f.r.snapshot(f.lease).get("calls")).isEmpty());count=f.events.size();f.e.listener.connected(11,false);f.e.listener.terminated(11,200);check(f.events.size()==count);
    fails("E_CALL_ID_REUSED",()->f.invite());fails("E_CLEANUP_REQUIRED",()->f.r.register(f.lease,"7",300));check(Boolean.TRUE.equals(f.r.snapshot(f.lease).get("cleanupRequired")));f.r.destroy(f.lease);
    Fixture incoming=new Fixture();incoming.e.listener.incoming(11,7,true,"\"Secret Name\" <sip:1020@example.test;password=hidden>");check("sip:1020@example.test".equals(call(incoming).get("remoteUri")));check(Boolean.TRUE.equals(call(incoming).get("videoOffered")));
    incoming.e.fail="answer";fails("E_SIPRIX_-77",()->incoming.r.answer(incoming.lease,"11"));check("ringing".equals(call(incoming).get("state")));incoming.e.fail=null;incoming.r.answer(incoming.lease,"11");incoming.r.answer(incoming.lease,"11");check(incoming.e.answers==1);check("ringing".equals(call(incoming).get("state")));
    incoming.e.listener.incoming(12,7,false,"sip:200@example.test");check(incoming.e.ends==1);check("11".equals(call(incoming).get("id")));incoming.connect();check("connected".equals(call(incoming).get("state")));
    Fixture acceptedAnswer=new Fixture();acceptedAnswer.e.rejectAfterAnswerFailure=true;acceptedAnswer.e.listener.incoming(11,7,false,"sip:1020@example.test");
    acceptedAnswer.r.answer(acceptedAnswer.lease,"11");check("ringing".equals(call(acceptedAnswer).get("state")));acceptedAnswer.r.end(acceptedAnswer.lease,"11");acceptedAnswer.r.end(acceptedAnswer.lease,"11");
    check(acceptedAnswer.e.ends==1);check(!acceptedAnswer.e.lastEndRejected);check("ringing".equals(call(acceptedAnswer).get("state")));acceptedAnswer.connect();check("ringing".equals(call(acceptedAnswer).get("state")));
    acceptedAnswer.e.listener.terminated(11,200);check(((List<?>)acceptedAnswer.r.snapshot(acceptedAnswer.lease).get("calls")).isEmpty());
    check("".equals(Phone11CallRuntime.safeUri("sip:user:password@example.test")));check("".equals(Phone11CallRuntime.safeUri("Secret Name")));
    Fixture cleanup=new Fixture();cleanup.invite();cleanup.connect();Phone11CallRuntime.Listener retained=cleanup.e.listener;cleanup.e.fail="destroy";fails("E_SIPRIX_-77",()->cleanup.r.destroy(cleanup.lease));check(Boolean.TRUE.equals(cleanup.r.snapshot(cleanup.lease).get("initialized")));fails("E_CLEANUP_REQUIRED",()->cleanup.r.end(cleanup.lease,"11"));
    count=cleanup.events.size();retained.terminated(11,200);retained.videoUpgrade(11);check(cleanup.e.rejectsVideo==0);check(cleanup.events.size()==count);check(((List<?>)cleanup.r.snapshot(cleanup.lease).get("calls")).size()==1);
    cleanup.e.fail=null;cleanup.r.destroy(cleanup.lease);check(((List<?>)cleanup.r.snapshot(cleanup.lease).get("calls")).isEmpty());
    Fixture shutdown=new Fixture();shutdown.e.fail="destroy";fails("E_SIPRIX_-77",()->shutdown.r.release(shutdown.lease));long replacement=shutdown.r.acquire();check(replacement>shutdown.lease);fails("E_CLEANUP_REQUIRED",()->shutdown.r.initialize(replacement));shutdown.e.fail=null;shutdown.r.destroy(replacement);shutdown.r.initialize(replacement);
    Fixture video=new Fixture();video.invite();video.e.listener.connected(11,true);check(video.e.ends==1);check("dialing".equals(call(video).get("state")));check("error".equals(video.events.get(video.events.size()-1).get("type")));
    Fixture privacy=new Fixture();privacy.e.listener.registration(7,1,"401 user/password/token");check(!privacy.events.toString().contains("password"));check(!privacy.events.toString().contains("sipStatusCode=401"));
    System.out.println("PASS "+assertions+" isolated Android state assertions; no SDK runtime, SIP, audio, or device acceptance");
  }
}
