package ai.phone11.siprix;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Bounded CPU leases only; this grants no call, binding, service or SIP authority. */
final class Phone11WakeCpuState {
  interface Lock { void release(); }
  interface Factory { Lock acquire(long timeoutMillis); }
  interface Clock { long elapsedRealtime(); }
  interface Cancellation { void cancel(); }
  interface Scheduler { Cancellation after(long delayMillis, Runnable task); }
  static final long MAX_MILLIS = 30_000;
  private static final int MAX_HANDOFFS = 8;
  static final class Owner {
    final String handoff, callUUID, bindingId;
    final long epoch;
    private Owner(String handoff, String callUUID, String bindingId, long epoch) {
      this.handoff=handoff;this.callUUID=callUUID;this.bindingId=bindingId;this.epoch=epoch;
    }
  }
  private static final class Lease {
    final String callUUID,bindingId;final long expiry,deadline;final Lock lock;Owner owner;Cancellation timer;
    Lease(String callUUID,String bindingId,long expiry,long deadline,Lock lock){this.callUUID=callUUID;this.bindingId=bindingId;this.expiry=expiry;this.deadline=deadline;this.lock=lock;}
  }
  private final Factory factory;private final Clock clock;private final Scheduler scheduler;
  private final Map<String,Lease> leases=new HashMap<>();
  Phone11WakeCpuState(Factory factory,Clock clock,Scheduler scheduler){this.factory=factory;this.clock=clock;this.scheduler=scheduler;}
  synchronized String acquire(String callUUID,String bindingId,long expiry,long wallNow) {
    prune();
    if(!uuid(callUUID)||!uuid(bindingId)||expiry<=wallNow||expiry-wallNow>MAX_MILLIS||leases.size()>=MAX_HANDOFFS)return null;
    final long timeout=expiry-wallNow,deadline=clock.elapsedRealtime()+timeout;final String handoff=UUID.randomUUID().toString();
    Lock lock=factory.acquire(timeout);
    if(lock==null)return null;
    leases.put(handoff,new Lease(callUUID,bindingId,expiry,deadline,lock));
    long remaining=deadline-clock.elapsedRealtime();if(remaining<=0){releaseToken(handoff);return null;}
    try{leases.get(handoff).timer=scheduler.after(remaining,()->expire(handoff));}catch(RuntimeException failure){releaseToken(handoff);throw failure;}
    return handoff;
  }
  synchronized Owner adopt(String handoff,String callUUID,String bindingId,long epoch,long expiry) {
    prune();Lease lease=leases.get(handoff);
    if(lease==null||lease.owner!=null||epoch<=0||lease.expiry!=expiry||!lease.callUUID.equals(callUUID)||!lease.bindingId.equals(bindingId))return null;
    lease.owner=new Owner(handoff,callUUID,bindingId,epoch);return lease.owner;
  }
  synchronized void releaseHandoff(String handoff){Lease lease=leases.get(handoff);if(lease!=null&&lease.owner==null)releaseToken(handoff);}
  synchronized void release(Owner owner){if(owner==null)return;Lease lease=leases.get(owner.handoff);if(lease!=null&&lease.owner==owner)releaseToken(owner.handoff);}
  private synchronized void expire(String handoff){Lease lease=leases.get(handoff);if(lease!=null&&lease.deadline<=clock.elapsedRealtime())releaseToken(handoff);}
  private void prune(){for(String handoff:leases.keySet().toArray(new String[0])){Lease lease=leases.get(handoff);if(lease.deadline<=clock.elapsedRealtime())releaseToken(handoff);}}
  private void releaseToken(String handoff){
    Lease lease=leases.remove(handoff);if(lease==null)return;
    try{if(lease.timer!=null)lease.timer.cancel();}catch(RuntimeException ignored){/* A cancellation failure must not retain CPU ownership. */}
    try{lease.lock.release();}catch(RuntimeException ignored){/* The framework timeout may already have released the lock. */}
  }
  private static boolean uuid(String value){try{return value!=null&&UUID.fromString(value).toString().equals(value);}catch(IllegalArgumentException failure){return false;}}
}
