package ai.phone11.siprix;

/** Pure JVM contract checks. These synthetic decisions are L0, never FCM evidence. */
public final class PendingWakeStoreTest {
  private static final long NOW = 1_000_000L;
  private static final String BINDING = "11111111-1111-4111-8111-111111111111";
  private static final String CALL_A = "33333333-3333-4333-8333-333333333333";
  private static final String CALL_B = "44444444-4444-4444-8444-444444444444";

  static final class Memory implements Phone11PendingWakeStore.Persistence {
    String value;
    public String read() { return value; }
    public void write(String next) { value = next; }
    public void clear() { value = null; }
  }

  private static Phone11PendingWakeStore.Binding binding(String id, String session, long expiry) {
    return new Phone11PendingWakeStore.Binding(id, 7, 11, "device-a", session, expiry);
  }

  private static Phone11PendingWakeStore.Wake wake(String call, String binding, long expiry) {
    return new Phone11PendingWakeStore.Wake(1, call, binding, expiry);
  }

  private static void check(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }

  public static void main(String[] args) {
    int assertions = 0;
    Memory memory = new Memory();
    Phone11PendingWakeStore store = new Phone11PendingWakeStore(memory);
    check(store.receive(wake(CALL_A, BINDING, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT, "wake before binding"); assertions++;
    check(store.bind(binding(BINDING, "session-a", NOW + 90_000), NOW)
        == Phone11PendingWakeStore.Decision.ACCEPTED, "bind"); assertions++;
    check(!memory.value.contains("device-a") && !memory.value.contains("session-a"),
        "device and session proof are persisted only as hashes"); assertions++;
    check(store.receive(wake(CALL_A, BINDING, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.ACCEPTED, "first wake"); assertions++;
    check(store.receive(wake(CALL_A, BINDING, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.DUPLICATE, "duplicate wake"); assertions++;
    check(store.receive(wake(CALL_B, BINDING, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_BUSY, "single pending owner"); assertions++;
    check(store.complete(CALL_A, NOW + 1) == Phone11PendingWakeStore.Decision.COMPLETED,
        "completion tombstone"); assertions++;
    check(store.receive(wake(CALL_A, BINDING, NOW + 30_000), NOW + 2)
        == Phone11PendingWakeStore.Decision.DUPLICATE, "completed replay"); assertions++;

    Memory restartMemory = memory;
    Phone11PendingWakeStore afterRestart = new Phone11PendingWakeStore(restartMemory);
    check(afterRestart.snapshot().callState.equals("completed"), "state survives process recreation"); assertions++;
    check(afterRestart.cancel(wake(CALL_B, BINDING, NOW + 40_000), NOW + 3)
        == Phone11PendingWakeStore.Decision.CANCELLED, "cancel before wake"); assertions++;
    check(afterRestart.receive(wake(CALL_B, BINDING, NOW + 40_000), NOW + 4)
        == Phone11PendingWakeStore.Decision.REJECTED_CANCELLED, "cancelled wake cannot ring"); assertions++;
    check(afterRestart.receive(wake(CALL_A, "22222222-2222-4222-8222-222222222222", NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_WRONG_BINDING, "wrong binding"); assertions++;
    check(afterRestart.receive(wake(CALL_A, BINDING, NOW - 1), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_EXPIRED, "expired wake"); assertions++;
    check(afterRestart.receive(wake(CALL_A, BINDING,
        NOW + Phone11PendingWakeStore.MAX_WAKE_TTL_MS + 1), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_MALFORMED, "unbounded TTL"); assertions++;

    String rotated = "22222222-2222-4222-8222-222222222222";
    check(afterRestart.bind(binding(rotated, "session-b", NOW + 90_000), NOW)
        == Phone11PendingWakeStore.Decision.ACCEPTED, "session rotation"); assertions++;
    check(afterRestart.snapshot().callUUID == null, "rotation removes prior owner call"); assertions++;
    check(afterRestart.receive(wake(CALL_A, BINDING, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_WRONG_BINDING, "old session isolated"); assertions++;
    afterRestart.logout();
    check(!afterRestart.snapshot().bound, "logout removes binding"); assertions++;
    check(afterRestart.receive(wake(CALL_A, rotated, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT, "late wake after logout"); assertions++;

    memory.value = "corrupt|private|state";
    check(!afterRestart.snapshot().bound && memory.value == null, "corrupt persistence fails closed"); assertions++;
    check(afterRestart.bind(binding(BINDING, "contains|delimiter", NOW + 90_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_MALFORMED, "unsafe opaque value"); assertions++;
    System.out.println("PASS: " + assertions + " persisted Android wake assertions (L0; no FCM delivery)");
  }
}
