package ai.phone11.siprix;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.siprix.SiprixCore;
import java.io.File;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Synthetic lab only. Call methods on the SDK's main-thread queue. No microphone API. */
public final class LabMedia {
 public static final int MAX_RECORDING_MS=20_000, TONE_MS=3_000, TEARDOWN_GRACE_MS=2_000;
 private final Context context; private final SiprixCore core; private final Handler main;
 private final Runnable stateChanged,teardown;
 private File recording; private int callId=-1, playerId=-1; private long generation=-1, startedAt=0, elapsedMs=0;
 private boolean active=false; private String status="idle", toneStatus="not_started", stopReason="none", errorCode="";
 private Runnable deadline,fallback;
 public static final class Failure extends RuntimeException {
  public final String code;
  Failure(String code){super(code);this.code=code;}
 }
 public LabMedia(Context context,SiprixCore core,Handler main,Runnable stateChanged,Runnable teardown){
  this.context=context.getApplicationContext();this.core=core;this.main=main;
  if(stateChanged==null||teardown==null)throw new Failure("E_LAB_MEDIA_CALLBACKS");
  this.stateChanged=stateChanged;this.teardown=teardown;
  if(!"ai.phone11.mobile.lab".equals(this.context.getPackageName()))throw new Failure("E_LAB_MEDIA_SCOPE");
 }
 private void thread(){if(Looper.myLooper()!=main.getLooper()||main.getLooper()!=Looper.getMainLooper())throw new Failure("E_LAB_MEDIA_THREAD");}
 private void check(int code,String operation){if(code!=SiprixCore.kOK)throw new Failure("E_LAB_MEDIA_"+operation+"_"+code);}
 private File target() throws IOException {
  File files=context.getExternalFilesDir(null);
  if(files==null)throw new Failure("E_LAB_MEDIA_STORAGE");
  File base=files.getCanonicalFile(),dir=new File(base,"lab-media");
  if((!dir.isDirectory()&&!dir.mkdirs())||!dir.getCanonicalFile().equals(dir.getAbsoluteFile()))throw new Failure("E_LAB_MEDIA_STORAGE");
  File file=new File(dir,"siprix-duplex.mp3");
  if(!file.getCanonicalFile().equals(file.getAbsoluteFile()))throw new Failure("E_LAB_MEDIA_STORAGE");
  return file;
 }
 /** Parent must first validate current generation, owned connected call, and synthetic destination. */
 public Map<String,Object> start(int id,long epoch) throws IOException {
  thread();if(id<=0||epoch<0||active)throw new Failure("E_LAB_MEDIA_STATE");
  File file=target();if(file.exists())throw new Failure("E_LAB_MEDIA_EXPORT_OR_CLEAR_FIRST");
  check(core.callRecordFile(id,file.getAbsolutePath()),"RECORD");
  recording=file;callId=id;generation=epoch;active=true;startedAt=SystemClock.elapsedRealtime();elapsedMs=0;
  status="recording";stopReason="none";errorCode="";toneStatus="not_started";playerId=-1;
  final long current=epoch;final int currentCall=id;
  deadline=()->{if(active&&generation==current&&callId==currentCall){
   try{stop("deadline");}catch(RuntimeException failure){
    errorCode=failure instanceof Failure?((Failure)failure).code:"E_LAB_MEDIA_STOP_EXCEPTION";status="stop_failed";
    // Recording stop failed: terminate this same synthetic call as a bounded fallback.
    try{int result=core.callBye(currentCall);if(result!=SiprixCore.kOK)errorCode+=";E_LAB_MEDIA_BYE_"+result;}
    catch(RuntimeException byeError){errorCode+=";E_LAB_MEDIA_BYE_EXCEPTION";}
    // Command acceptance is not termination. Escalate even if BYE returned OK but no callback follows.
    fallback=()->{if(active&&generation==current&&callId==currentCall){
     status="teardown_requested";stopReason="deadline_teardown";
     try{teardown.run();}catch(RuntimeException teardownError){errorCode+=";E_LAB_MEDIA_TEARDOWN_FAILED";}
     if(active){status="teardown_failed";errorCode+=";E_LAB_MEDIA_TEARDOWN_UNCONFIRMED";}
     changed();
    }};
    main.postDelayed(fallback,TEARDOWN_GRACE_MS);
   }
   changed();
  }};
  main.postDelayed(deadline,MAX_RECORDING_MS);return snapshot();
 }
 /** Fixed DTMF-1 audio waveform, not callSendDtmf/RFC2833 signaling and never callId=0. */
 public Map<String,Object> inject(int id,long epoch){
  thread();if(!active||id!=callId||epoch!=generation||!"not_started".equals(toneStatus))throw new Failure("E_LAB_MEDIA_STATE");
  if(SystemClock.elapsedRealtime()-startedAt>MAX_RECORDING_MS-TONE_MS)throw new Failure("E_LAB_MEDIA_TOO_LATE");
  SiprixCore.IdOutArg out=new SiprixCore.IdOutArg();check(core.callPlayTone(id,"1",TONE_MS,out),"TONE");
  playerId=out.value;toneStatus="accepted";return snapshot();
 }
 public Map<String,Object> stop(){return stop("manual");}
 private Map<String,Object> stop(String reason){
  thread();if(!active)return snapshot();
  int code=core.callStopRecordFile(callId);
  if(code!=SiprixCore.kOK){errorCode="E_LAB_MEDIA_STOP_"+code;status="stop_failed";throw new Failure(errorCode);}
  active=false;elapsedMs=SystemClock.elapsedRealtime()-startedAt;status="stopped";stopReason=reason;
  cancelDeadline();return snapshot();
 }
 /** Forward the existing generation-filtered model callback after SDK call termination. */
 public void onCallTerminated(int id,long epoch){
  thread();if(id!=callId||epoch!=generation)return;
  if(active){active=false;elapsedMs=SystemClock.elapsedRealtime()-startedAt;status="call_ended";stopReason="call_terminated";}
  if("playing".equals(toneStatus)||"accepted".equals(toneStatus))toneStatus="cancelled_by_call_end";
  cancelDeadline();changed();
 }
 public void onPlayerState(int id,SiprixCore.PlayerState state,long epoch){
  thread();if(id!=playerId||epoch!=generation)return;
  toneStatus=state==SiprixCore.PlayerState.STARTED?"playing":state==SiprixCore.PlayerState.STOPPED?"stopped":"failed";
  if(state==SiprixCore.PlayerState.FAILED)errorCode+=(errorCode.isEmpty()?"":";")+"E_LAB_MEDIA_TONE_CALLBACK";
  changed();
 }
 /** Invoke only after successful core.unInitialize(); retained file still requires decode verification. */
 public void onCoreDestroyed(){
  thread();if(active){elapsedMs=SystemClock.elapsedRealtime()-startedAt;status="core_destroyed_unverified";stopReason="core_destroyed";}
  active=false;generation=-1;playerId=-1;if("playing".equals(toneStatus)||"accepted".equals(toneStatus))toneStatus="cancelled_by_destroy";cancelDeadline();changed();
 }
 /** Explicit export-then-delete; never deletes while SDK may still write the file. */
 public Map<String,Object> clear() throws IOException {
  thread();if(active||"playing".equals(toneStatus)||"accepted".equals(toneStatus))throw new Failure("E_LAB_MEDIA_BUSY");
  File file=target();if(file.exists()&&(!file.isFile()||!file.delete()))throw new Failure("E_LAB_MEDIA_DELETE");
  recording=null;callId=-1;generation=-1;startedAt=0;elapsedMs=0;status="idle";toneStatus="not_started";stopReason="none";errorCode="";
  return snapshot();
 }
 private void cancelDeadline(){
  if(deadline!=null){main.removeCallbacks(deadline);deadline=null;}
  if(fallback!=null){main.removeCallbacks(fallback);fallback=null;}
 }
 private void changed(){try{stateChanged.run();}catch(RuntimeException notificationError){
  // A detached React instance must not prevent the recording watchdog or teardown.
  errorCode+=";E_LAB_MEDIA_NOTIFY";
 }}
 public Map<String,Object> snapshot(){
  thread();Map<String,Object> out=new LinkedHashMap<>();out.put("status",status);out.put("active",active);
  out.put("path",recording==null?null:recording.getAbsolutePath());out.put("bytes",recording!=null&&recording.isFile()?(double)recording.length():0d);
  out.put("elapsedMs",(double)(active?SystemClock.elapsedRealtime()-startedAt:elapsedMs));out.put("maxRecordingMs",MAX_RECORDING_MS);
  out.put("tone","1");out.put("toneMs",TONE_MS);out.put("toneStatus",toneStatus);out.put("stopReason",stopReason);out.put("errorCode",errorCode);
  out.put("verified",false);out.put("scope","synthetic SDK media; decode and independent peer evidence required");return out;
 }
}
