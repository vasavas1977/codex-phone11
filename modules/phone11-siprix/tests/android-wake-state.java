package ai.phone11.siprix;

class AndroidWakeStateTest {
  static int assertions;
  static final String B = "10000000-0000-4000-8000-000000000001";
  static final String C = "20000000-0000-4000-8000-000000000001";
  static final String D = "20000000-0000-4000-8000-000000000002";
  static Phone11AndroidWakeState.Binding binding(String owner, long expiry) {
    return new Phone11AndroidWakeState.Binding(B, owner, "10", "device", "30000000-0000-4000-8000-000000000001", expiry);
  }
  static void check(boolean value) { ++assertions; if (!value) throw new AssertionError("assertion " + assertions); }
  public static void main(String[] args) {
    Phone11AndroidWakeState s = new Phone11AndroidWakeState();
    check(s.receive(B, C, 2000, 1000) == null);
    s.bind(binding("1", 100000), 1000);
    check(s.receive(D, C, 2000, 1000) == null);
    check(s.receive(B, "bad", 2000, 1000) == null);
    check(s.receive(B, C, 1000, 1000) == null);
    check(s.receive(B, C, 62000, 1000) == null);
    Phone11AndroidWakeState.Ticket first = s.receive(B, C, 3000, 1000);
    check(first != null && s.phase() == Phone11AndroidWakeState.Phase.CLAIMING);
    check(s.receive(B, D, 3000, 1000) == null);
    check(!s.answer(first, 1000));
    check(!s.claimed(first, binding("2", 3000), 1000));
    check(!s.claimed(first, binding("1", 3100), 1000));
    check(s.claimed(first, binding("1", 3000), 1000));
    check(!s.connected(first, 1000));
    check(s.ready(first, 1000));
    check(s.ringing(first, 1000));
    check(s.answer(first, 1000));
    check(!s.answer(first, 1000));
    check(s.connected(first, 1000));
    check(s.isCurrent(first, 4000)); // Connected call can outlive the offer deadline.
    check(s.end(first, 4000));
    check(!s.isCurrent(first, 4000));
    check(s.receive(B, C, 5000, 4000) == null); // Replay cannot restart the SDK.
    Phone11AndroidWakeState.Ticket second = s.receive(B, D, 6000, 4000);
    check(second != null);
    check(!s.end(first, 4000)); // Late callback cannot end the replacement.
    check(!s.claimed(first, binding("1", 3000), 4000));
    check(s.isCurrent(second, 4000));
    s.bind(binding("2", 100000), 4000);
    check(!s.isCurrent(second, 4000)); // Account switch fences every operation.
    check(s.phase() == Phone11AndroidWakeState.Phase.IDLE);
    Phone11AndroidWakeState.Ticket third = s.receive(B, D, 7000, 4000);
    check(third != null);
    s.bind(binding("2", 80000), 4000);
    check(s.isCurrent(third, 4000)); // Same-owner refresh keeps correlation.
    check(!s.isCurrent(third, 7000));
    check(s.receive(B, D, 9000, 7000) == null);
    s.revoke();
    check(s.binding() == null && s.ticket() == null);
    check(s.receive(B, C, 9000, 7000) == null);
    s.bind(binding("1", 10000), 7000);
    Phone11AndroidWakeState.Ticket expired = s.receive(B, C, 9000, 7000);
    check(expired != null);
    check(s.claimed(expired, binding("1", 9000), 7000));
    check(s.ready(expired, 7000));
    check(s.ringing(expired, 7000));
    check(s.answer(expired, 7000));
    check(s.connected(expired, 7000));
    check(!s.isCurrent(expired, 10000)); // Binding expiration still terminates active authority.
    check(s.binding() == null);
    boolean rejected = false;
    try { s.bind(binding("1", 10000), 10000); } catch (IllegalArgumentException e) { rejected = true; }
    check(rejected);
    for (String owner : new String[] {"0", "-1", "01", "1.5", "9007199254740992", "user"}) {
      rejected = false;
      try { binding(owner, 100000); } catch (IllegalArgumentException e) { rejected = true; }
      check(rejected);
    }
    rejected = false;
    try { new Phone11AndroidWakeState.Binding(B, "1", "10", "device", "session", 100000); }
    catch (IllegalArgumentException e) { rejected = true; }
    check(rejected);
    System.out.println("PASS " + assertions + " wake identity/lifecycle assertions");
  }
}
