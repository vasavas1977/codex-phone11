package ai.phone11.siprix;

import java.util.HashMap;
import java.util.Map;

/** Pure JVM FCM-envelope and persisted-owner checks; no provider is contacted. */
public final class FcmWakeEnvelopeTest {
  private static final long NOW = 1_000_000L;
  private static final String BINDING = "11111111-1111-4111-8111-111111111111";
  private static final String ROTATED = "22222222-2222-4222-8222-222222222222";
  private static final String CALL = "33333333-3333-4333-8333-333333333333";

  static final class Memory implements Phone11PendingWakeStore.Persistence {
    String value;
    public String read() { return value; }
    public void write(String next) { value = next; }
    public void clear() { value = null; }
  }

  private static Map<String, String> payload(String call, String binding, long expiry) {
    Map<String, String> data = new HashMap<>();
    data.put("v", "1"); data.put("callUUID", call); data.put("bindingId", binding);
    data.put("expiresAt", Long.toString(expiry));
    return data;
  }

  private static Phone11PendingWakeStore.Binding binding(String id, String session) {
    return new Phone11PendingWakeStore.Binding(id, 7, 11, "device-a", session, NOW + 90_000);
  }

  private static void check(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }

  private static Phone11PendingWakeStore.Decision receive(Phone11PendingWakeStore store,
      Map<String, String> data, long now) {
    Phone11PendingWakeStore.Wake wake = Phone11FcmWakeEnvelope.parse(data);
    return wake == null ? Phone11PendingWakeStore.Decision.REJECTED_MALFORMED : store.receive(wake, now);
  }

  public static void main(String[] args) {
    int assertions = 0;
    Map<String, String> good = payload(CALL, BINDING, NOW + 30_000);
    check(Phone11FcmWakeEnvelope.isPhone11(good), "Phone11 envelope reserved"); assertions++;
    check(!Phone11FcmWakeEnvelope.isPhone11(Map.of("genericAlert", "opaque")),
        "generic alert remains delegated"); assertions++;
    check(Phone11FcmWakeEnvelope.parse(good) != null, "exact envelope"); assertions++;
    for (String key : new String[]{"v", "callUUID", "bindingId", "expiresAt"}) {
      Map<String, String> missing = new HashMap<>(good); missing.remove(key);
      check(Phone11FcmWakeEnvelope.parse(missing) == null, "missing " + key); assertions++;
    }
    for (String value : new String[]{"0", "01", "2", ""}) {
      Map<String, String> bad = new HashMap<>(good); bad.put("v", value);
      check(Phone11FcmWakeEnvelope.parse(bad) == null, "version " + value); assertions++;
    }
    for (String value : new String[]{"0", "-1", "+1", "1.0", "9223372036854775808", ""}) {
      Map<String, String> bad = new HashMap<>(good); bad.put("expiresAt", value);
      check(Phone11FcmWakeEnvelope.parse(bad) == null, "expiry " + value); assertions++;
    }
    Map<String, String> secret = new HashMap<>(good); secret.put("grant", "must-not-enter-device");
    check(Phone11FcmWakeEnvelope.parse(secret) == null, "secret/extra field"); assertions++;

    Memory memory = new Memory();
    Phone11PendingWakeStore store = new Phone11PendingWakeStore(memory);
    check(receive(store, good, NOW) == Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT,
        "unbound payload"); assertions++;
    store.bind(binding(BINDING, "session-a"), NOW);
    check(receive(store, good, NOW) == Phone11PendingWakeStore.Decision.ACCEPTED,
        "bound payload"); assertions++;
    check(receive(store, good, NOW) == Phone11PendingWakeStore.Decision.DUPLICATE,
        "duplicate payload"); assertions++;
    check(receive(store, payload(CALL, BINDING, NOW - 1), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_EXPIRED, "expired payload"); assertions++;
    store.cancel(new Phone11PendingWakeStore.Wake(1, CALL, BINDING, NOW + 30_000), NOW);
    check(receive(store, good, NOW) == Phone11PendingWakeStore.Decision.REJECTED_CANCELLED,
        "cancelled payload"); assertions++;
    store.bind(binding(ROTATED, "session-b"), NOW);
    check(receive(store, good, NOW) == Phone11PendingWakeStore.Decision.REJECTED_WRONG_BINDING,
        "rotated payload"); assertions++;
    store.logout();
    check(receive(store, payload(CALL, ROTATED, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT, "logout payload"); assertions++;
    memory.value = "corrupt|state|with|private|pieces";
    check(receive(store, payload(CALL, ROTATED, NOW + 30_000), NOW)
        == Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT && memory.value == null,
        "corrupt state payload"); assertions++;

    System.out.println("PASS: " + assertions
        + " Android FCM ingress assertions (L0; no Firebase project or delivery)");
  }
}
