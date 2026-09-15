package ai.phone11.siprix;
import android.content.Context;
import android.os.Handler;
import com.siprix.SiprixCore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Map;

/** Pure JVM watchdog/callback tests. Stub SDK results are not native media proof. */
public final class MediaLifecycleTest {
 static final class Fixture implements AutoCloseable {
  final Path dir;final Handler main=new Handler();final SiprixCore core=new SiprixCore();
  final LabMedia media;int notifications=0,teardowns=0;boolean teardownSucceeds=true;
  Fixture()throws Exception{
   dir=Files.createTempDirectory("phone11-media-jvm-");
   media=new LabMedia(new Context(dir.toFile()),core,main,()->notifications++,()->destroy());
  }
  void destroy(){teardowns++;if(teardownSucceeds)media.onCoreDestroyed();else throw new IllegalStateException("stub teardown unavailable");}
  public void close()throws Exception{try(var paths=Files.walk(dir)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.delete(p);}}
 }
 static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
 static boolean active(Fixture f){return Boolean.TRUE.equals(f.media.snapshot().get("active"));}
 public static void main(String[] args)throws Exception{
  try(Fixture f=new Fixture()){
   f.core.stopCode=8;f.core.byeCode=9;f.media.start(200,1);f.main.advance(20000);
   check(f.core.stops==1&&f.core.byes==1&&f.teardowns==0&&active(f),"stop/bye failure must remain active before fallback");
   f.main.advance(1999);check(f.teardowns==0,"fallback cannot run early");f.main.advance(1);
   Map<String,Object>s=f.media.snapshot();check(f.teardowns==1&&!active(f)&&f.main.pending()==0,"bounded teardown must cancel watchdogs");
   check(s.get("status").equals("core_destroyed_unverified")&&s.get("verified").equals(false),"forced teardown cannot claim finalized media");
   check(s.get("errorCode").toString().contains("STOP_8")&&s.get("errorCode").toString().contains("BYE_9"),"original failure must remain available");
   check(f.notifications>=2,"async state updates must notify UI");
  }
  try(Fixture f=new Fixture()){
   f.core.stopCode=8;f.media.start(200,1);f.main.advance(22000);
   check(f.core.byes==1&&f.teardowns==1,"accepted BYE without termination callback must still escalate");
  }
  try(Fixture f=new Fixture()){
   f.core.stopCode=8;f.media.start(200,1);f.main.advance(20000);f.media.onCallTerminated(200,1);f.main.advance(3000);
   check(!active(f)&&f.teardowns==0&&f.main.pending()==0,"matching termination must cancel escalation");
  }
  try(Fixture f=new Fixture()){
   f.media.start(200,1);f.media.inject(200,1);int count=f.notifications;
   f.media.onPlayerState(701,SiprixCore.PlayerState.STOPPED,0);check(f.notifications==count,"stale player callback cannot mutate state");
   f.media.onPlayerState(701,SiprixCore.PlayerState.STOPPED,1);check(f.notifications==count+1,"current player callback must notify");
   f.media.stop();f.main.advance(22000);check(f.teardowns==0&&f.main.pending()==0,"manual stop must cancel watchdog");
  }
  try(Fixture f=new Fixture()){
   f.core.stopCode=8;f.core.byeCode=9;f.teardownSucceeds=false;f.media.start(200,1);f.main.advance(22000);
   check(active(f)&&f.media.snapshot().get("status").equals("teardown_failed"),"failed runtime teardown must stay visibly unresolved");
   check(f.media.snapshot().get("verified").equals(false),"failed teardown is never media proof");
  }
  try(Fixture f=new Fixture()){
   f.core.throwStop=true;f.core.throwBye=true;f.media.start(200,1);f.main.advance(22000);
   check(f.teardowns==1&&!active(f),"SDK exceptions must still reach bounded teardown");
   check(f.media.snapshot().get("errorCode").toString().contains("BYE_EXCEPTION"),"exception details must reduce to safe code");
  }
  System.out.println("PASS: 6 synthetic JVM lifecycle scenarios; no native audio proof");
 }
}
