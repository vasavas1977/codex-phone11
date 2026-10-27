package ai.phone11.siprix;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Injected JVM timing/lock failures, with the actual wake admission state machine. */
final class AndroidWakeCpuTest {
  static int checks;
  static final String CALL="00000000-0000-0000-0000-000000000001",NEXT="00000000-0000-0000-0000-000000000002",BINDING="00000000-0000-0000-0000-000000000003",SESSION="00000000-0000-0000-0000-000000000004";
  static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
  static final class Lock implements Phone11WakeCpuState.Lock {
    final long timeout;int releases;boolean releaseFails;
    Lock(long timeout){this.timeout=timeout;}
    public void release(){releases++;if(releaseFails)throw new IllegalStateException("already timed out");}
  }
  static final class Fixture {
    long elapsed=50,wall=100_000,acquireDelay;boolean acquireFails,scheduleFails;
    final List<Lock> locks=new ArrayList<>();final List<Runnable> timers=new ArrayList<>();final List<Boolean> cancelled=new ArrayList<>();
    final Phone11WakeCpuState cpu=new Phone11WakeCpuState(timeout->{if(acquireFails)throw new SecurityException("denied");Lock lock=new Lock(timeout);locks.add(lock);elapsed+=acquireDelay;return lock;},()->elapsed,(delay,task)->{if(scheduleFails)throw new IllegalStateException("main stopped");timers.add(task);int index=cancelled.size();cancelled.add(false);return ()->cancelled.set(index,true);});
    String handoff(String uuid,long duration){return cpu.acquire(uuid,BINDING,wall+duration,wall);}
    Phone11WakeCpuState.Owner adopt(String token,String uuid,long epoch,long duration){return cpu.adopt(token,uuid,BINDING,epoch,wall+duration);}
  }
  static void rejected(Runnable task){try{task.run();throw new AssertionError("expected refusal");}catch(SecurityException|IllegalStateException expected){check(true);}}
  public static void main(String[] args)throws InterruptedException{
    Fixture invalid=new Fixture();check(invalid.handoff(CALL,0)==null);check(invalid.handoff(CALL,-1)==null);check(invalid.handoff(CALL,30_001)==null);check(invalid.handoff("bad",1000)==null);check(invalid.cpu.acquire(CALL,"bad",invalid.wall+1000,invalid.wall)==null);check(invalid.locks.isEmpty());
    Fixture f=new Fixture();String token=f.handoff(CALL,30_000);check(token!=null&&f.locks.get(0).timeout==30_000);check(f.adopt(token,NEXT,1,30_000)==null);check(f.adopt(token,CALL,0,30_000)==null);check(f.adopt(token,CALL,1,29_999)==null);
    Phone11WakeCpuState.Owner first=f.adopt(token,CALL,1,30_000);check(first!=null&&first.epoch==1&&CALL.equals(first.callUUID)&&BINDING.equals(first.bindingId));check(f.adopt(token,CALL,1,30_000)==null);f.cpu.releaseHandoff(token);check(f.locks.get(0).releases==0);
    // A duplicate FCM handoff can be rejected without extending/releasing the accepted epoch.
    String duplicate=f.handoff(CALL,20_000);f.cpu.releaseHandoff(duplicate);check(f.locks.get(1).releases==1&&f.locks.get(0).releases==0);check(f.locks.get(0).timeout==30_000);
    f.cpu.release(first);f.cpu.release(first);check(f.locks.get(0).releases==1&&f.cancelled.get(0));
    String later=f.handoff(NEXT,10_000);Phone11WakeCpuState.Owner second=f.adopt(later,NEXT,2,10_000);check(second!=null);
    // Late predecessor service destruction, HTTP failure or timer cannot release a newer owner.
    f.cpu.release(first);f.cpu.releaseHandoff(token);f.elapsed+=30_000;f.timers.get(0).run();check(f.locks.get(2).releases==0);f.cpu.release(second);check(f.locks.get(2).releases==1);
    Fixture orphan=new Fixture();String pending=orphan.handoff(CALL,1000);orphan.elapsed+=1000;orphan.timers.get(0).run();check(orphan.locks.get(0).releases==1);check(orphan.adopt(pending,CALL,1,1000)==null);orphan.cpu.releaseHandoff(pending);check(orphan.locks.get(0).releases==1);
    Fixture lateTimer=new Fixture();String expired=lateTimer.handoff(CALL,1000);lateTimer.elapsed+=1000;check(lateTimer.adopt(expired,CALL,1,1000)==null);check(lateTimer.locks.get(0).releases==1);lateTimer.timers.get(0).run();check(lateTimer.locks.get(0).releases==1);
    Fixture adoptedTimeout=new Fixture();String timeout=adoptedTimeout.handoff(CALL,1000);Phone11WakeCpuState.Owner timeoutOwner=adoptedTimeout.adopt(timeout,CALL,1,1000);adoptedTimeout.elapsed+=1000;adoptedTimeout.timers.get(0).run();check(adoptedTimeout.locks.get(0).releases==1);adoptedTimeout.cpu.release(timeoutOwner);check(adoptedTimeout.locks.get(0).releases==1);
    Fixture failures=new Fixture();failures.acquireFails=true;rejected(()->failures.handoff(CALL,1000));check(failures.locks.isEmpty());failures.acquireFails=false;failures.scheduleFails=true;rejected(()->failures.handoff(CALL,1000));check(failures.locks.get(0).releases==1);failures.scheduleFails=false;String refused=failures.handoff(CALL,1000);failures.cpu.releaseHandoff(refused);check(failures.locks.get(1).releases==1);
    String raced=failures.handoff(CALL,1000);failures.locks.get(2).releaseFails=true;failures.cpu.releaseHandoff(raced);failures.cpu.releaseHandoff(raced);check(failures.locks.get(2).releases==1);
    Fixture slow=new Fixture();slow.acquireDelay=1000;check(slow.handoff(CALL,1000)==null);check(slow.locks.get(0).releases==1&&slow.timers.isEmpty());
    Fixture capped=new Fixture();for(int i=0;i<8;i++)check(capped.handoff(CALL,1000)!=null);check(capped.handoff(CALL,1000)==null&&capped.locks.size()==8);capped.elapsed+=1000;check(capped.handoff(CALL,1000)!=null);for(int i=0;i<8;i++)check(capped.locks.get(i).releases==1);
    // Connection releases setup power while preserving the actual active call state.
    Fixture connected=new Fixture();Phone11AndroidWakeState state=new Phone11AndroidWakeState();state.bind(new Phone11AndroidWakeState.Binding(BINDING,"1","2","device",SESSION,connected.wall+60_000),connected.wall);
    String incoming=connected.handoff(CALL,20_000);Phone11AndroidWakeState.Ticket ticket=state.receive(BINDING,CALL,connected.wall+20_000,connected.wall);check(ticket!=null);
    Phone11WakeCpuState.Owner callOwner=connected.adopt(incoming,CALL,ticket.epoch,20_000);check(callOwner!=null);
    check(state.claimed(ticket,new Phone11AndroidWakeState.Binding(BINDING,"1","2","device",SESSION,ticket.expiresAt),connected.wall));check(state.ready(ticket,connected.wall));check(state.ringing(ticket,connected.wall));check(state.answer(ticket,connected.wall));check(state.connected(ticket,connected.wall));connected.cpu.release(callOwner);check(connected.locks.get(0).releases==1&&state.phase()==Phone11AndroidWakeState.Phase.ACTIVE);connected.elapsed+=20_000;connected.timers.get(0).run();check(connected.locks.get(0).releases==1);check(state.isCurrent(ticket,connected.wall+21_000));
    // Block this test's main thread and leave its main-work queue untouched: the actual
    // production deadline worker must release the lease without any main callback running.
    try(Phone11WakeCpuTimer independent=new Phone11WakeCpuTimer()){
      CountDownLatch released=new CountDownLatch(1);AtomicInteger releaseCount=new AtomicInteger();AtomicReference<Thread> releaseThread=new AtomicReference<>();
      List<Runnable> pausedMain=new ArrayList<>();pausedMain.add(()->{throw new AssertionError("main queue must stay paused");});
      Phone11WakeCpuState cpu=new Phone11WakeCpuState(duration->()->{releaseThread.set(Thread.currentThread());releaseCount.incrementAndGet();released.countDown();},()->TimeUnit.NANOSECONDS.toMillis(System.nanoTime()),independent);
      long wall=System.currentTimeMillis();String pendingCpu=cpu.acquire(CALL,BINDING,wall+100,wall);check(pendingCpu!=null);
      Phone11WakeCpuState.Owner owner=cpu.adopt(pendingCpu,CALL,BINDING,42,wall+100);check(owner!=null);
      check(released.await(2,TimeUnit.SECONDS));check(pausedMain.size()==1);check(releaseThread.get()!=Thread.currentThread()&&releaseThread.get().isDaemon()&&"Phone11-WakeCpuDeadline".equals(releaseThread.get().getName()));
      cpu.release(owner);check(releaseCount.get()==1);
    }
    System.out.println("PASS "+checks+" wake CPU handoff/lifecycle/failure assertions; no Android runtime/device claim");
  }
}
