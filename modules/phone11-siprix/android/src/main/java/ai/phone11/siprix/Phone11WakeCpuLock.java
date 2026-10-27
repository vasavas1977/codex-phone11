package ai.phone11.siprix;

import android.content.Context;
import android.os.PowerManager;
import android.os.SystemClock;

/** Application-owned partial lock; an independent worker releases it if the main looper stalls. */
final class Phone11WakeCpuLock {
  static final String EXTRA_HANDOFF="ai.phone11.WAKE_CPU_HANDOFF";
  private static final Phone11WakeCpuTimer DEADLINES=new Phone11WakeCpuTimer();
  private static Phone11WakeCpuState state;
  static synchronized Phone11WakeCpuState get(Context context){
    if(state==null){
      final PowerManager power=(PowerManager)context.getApplicationContext().getSystemService(Context.POWER_SERVICE);
      state=new Phone11WakeCpuState(timeout->{
        if(!BuildConfig.WAKE_CANDIDATE_ENABLED||power==null)throw new IllegalStateException("Wake CPU lock unavailable");
        final PowerManager.WakeLock lock=power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Phone11:IncomingSetup");
        lock.setReferenceCounted(false);
        try{lock.acquire(timeout);}catch(RuntimeException failure){if(lock.isHeld())lock.release();throw failure;}
        return ()->{if(lock.isHeld())lock.release();};
      },SystemClock::elapsedRealtime,DEADLINES);
    }
    return state;
  }
}
