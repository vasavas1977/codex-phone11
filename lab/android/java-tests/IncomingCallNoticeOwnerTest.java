package ai.phone11.siprix;

/** Pure JVM ownership checks. These do not claim Android notification delivery. */
public final class IncomingCallNoticeOwnerTest {
  private static final long NOW = 2_000_000L;
  private static final String BINDING = "11111111-1111-4111-8111-111111111111";
  private static final String CALL = "33333333-3333-4333-8333-333333333333";

  static final class Memory implements Phone11PendingWakeStore.Persistence {
    String value;
    public String read() { return value; }
    public void write(String next) { value = next; }
    public void clear() { value = null; }
  }

  private static void check(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }

  public static void main(String[] args) {
    int assertions = 0;
    Phone11PendingWakeStore store = new Phone11PendingWakeStore(new Memory());
    check(!Phone11IncomingCallNoticeOwner.ownsPending(store.snapshot(), CALL, BINDING),
        "logged-out state cannot own an action"); assertions++;
    store.bind(new Phone11PendingWakeStore.Binding(BINDING, 7, 11, "device-a", "session-a",
        NOW + 90_000), NOW);
    store.receive(new Phone11PendingWakeStore.Wake(1, CALL, BINDING, NOW + 30_000), NOW);
    check(Phone11IncomingCallNoticeOwner.ownsPending(store.snapshot(), CALL, BINDING),
        "current pending owner"); assertions++;
    check(store.snapshot().callExpiresAt == NOW + 30_000,
        "notice timeout derives from the accepted bounded wake"); assertions++;
    check(!Phone11IncomingCallNoticeOwner.ownsPending(store.snapshot(),
        "44444444-4444-4444-8444-444444444444", BINDING), "stale call rejected"); assertions++;
    check(!Phone11IncomingCallNoticeOwner.ownsPending(store.snapshot(), CALL,
        "22222222-2222-4222-8222-222222222222"), "wrong binding rejected"); assertions++;

    int open = Phone11IncomingCallNoticeOwner.requestCode(CALL,
        Phone11IncomingCallNoticeOwner.OPEN);
    int answer = Phone11IncomingCallNoticeOwner.requestCode(CALL,
        Phone11IncomingCallNoticeOwner.ANSWER);
    int decline = Phone11IncomingCallNoticeOwner.requestCode(CALL,
        Phone11IncomingCallNoticeOwner.DECLINE);
    check(open >= 0 && answer == open + 1 && decline == open + 2,
        "stable distinct action request codes"); assertions++;
    check(Phone11IncomingCallNoticeOwner.requestCode(CALL,
        Phone11IncomingCallNoticeOwner.OPEN) == open, "request code replay stable"); assertions++;

    check(Phone11IncomingCallNoticeOwner.clearsNotice(
        Phone11PendingWakeStore.Decision.CANCELLED), "cancel clears"); assertions++;
    check(Phone11IncomingCallNoticeOwner.clearsNotice(
        Phone11PendingWakeStore.Decision.REJECTED_EXPIRED), "expiry clears"); assertions++;
    check(!Phone11IncomingCallNoticeOwner.clearsNotice(
        Phone11PendingWakeStore.Decision.REJECTED_WRONG_BINDING),
        "wrong binding cannot clear current owner"); assertions++;
    store.complete(CALL, NOW + 1);
    check(!Phone11IncomingCallNoticeOwner.ownsPending(store.snapshot(), CALL, BINDING),
        "terminal action cannot be replayed"); assertions++;
    System.out.println("PASS: " + assertions
        + " incoming-call notice ownership assertions (L0; no Android notification delivery)");
  }
}
