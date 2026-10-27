package ai.phone11.siprix;

import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Process-scoped deadline worker, independent of the Android main looper. */
final class Phone11WakeCpuTimer implements Phone11WakeCpuState.Scheduler, AutoCloseable {
  private final ScheduledThreadPoolExecutor executor;
  Phone11WakeCpuTimer(){
    executor=new ScheduledThreadPoolExecutor(1,task->{
      Thread thread=new Thread(task,"Phone11-WakeCpuDeadline");thread.setDaemon(true);return thread;
    });
    // Released leases must not leave timeout tasks queued for the rest of their deadline.
    executor.setRemoveOnCancelPolicy(true);
    executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
  }
  @Override public Phone11WakeCpuState.Cancellation after(long delayMillis,Runnable task){
    ScheduledFuture<?> future=executor.schedule(task,delayMillis,TimeUnit.MILLISECONDS);
    return ()->future.cancel(false);
  }
  @Override public void close(){executor.shutdownNow();}
}
