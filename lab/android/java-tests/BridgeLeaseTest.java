import ai.phone11.siprix.BridgeLease;
public class BridgeLeaseTest {
 public static void main(String[] args) {
  BridgeLease lease=new BridgeLease();
  BridgeLease.Ticket old=lease.acquire();
  int[] destroys={0};
  Runnable queuedDestroy=()->{if(lease.owns(old))destroys[0]++;};
  assert lease.owns(old);
  BridgeLease.Ticket replacement=lease.acquire();
  queuedDestroy.run();
  assert destroys[0]==0 : "Old queued destroy must not affect replacement";
  lease.release(old);
  assert lease.owns(replacement) : "Old invalidation must not revoke replacement";
  lease.release(replacement);
  assert !lease.owns(replacement) : "Invalidated bridge must reject commands";
  assert !lease.owns(old);
  System.out.println("5 bridge ownership assertions passed");
 }
}
