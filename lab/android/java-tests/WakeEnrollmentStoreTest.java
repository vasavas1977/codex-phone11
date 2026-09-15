package ai.phone11.siprix;

import java.lang.reflect.Field;
import java.util.Arrays;

/** Pure enrollment validation and rotation checks; no Firebase call is made. */
public final class WakeEnrollmentStoreTest {
  private static final long NOW = 1_000_000L;
  private static final String BINDING_A = "11111111-1111-4111-8111-111111111111";
  private static final String BINDING_B = "22222222-2222-4222-8222-222222222222";
  private static final String SESSION_A = "33333333-3333-4333-8333-333333333333";
  private static final String SESSION_B = "44444444-4444-4444-8444-444444444444";
  private static final String GRANT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  private static final String GRANT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  static final class Memory implements Phone11WakeEnrollmentStore.Persistence {
    String value;
    int clears;
    public String read() { return value; }
    public void write(String next) { value = next; }
    public void clear() { value = null; clears++; }
  }

  private static Phone11WakeEnrollmentStore.Enrollment enrollment(String binding,
      String session, String grant, long expiresAt) {
    return new Phone11WakeEnrollmentStore.Enrollment(binding, 7, 11, "device-a", session,
        expiresAt, grant);
  }

  private static void check(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }

  public static void main(String[] args) {
    int assertions = 0;
    Memory memory = new Memory();
    Phone11WakeEnrollmentStore store = new Phone11WakeEnrollmentStore(memory);
    check(store.publicBinding(NOW) == null, "empty"); assertions++;
    check(store.save(enrollment(BINDING_A, SESSION_A, GRANT_A, NOW + 60_000), NOW),
        "valid enrollment"); assertions++;
    check(store.grant(BINDING_A, NOW).equals(GRANT_A), "internal grant"); assertions++;
    Phone11WakeEnrollmentStore.Binding binding = store.publicBinding(NOW);
    check(binding != null && binding.bindingId.equals(BINDING_A), "public binding"); assertions++;
    check(binding.ownerUserId == 7 && binding.tenantId == 11, "owner and tenant"); assertions++;
    check(binding.deviceId.equals("device-a") && binding.sessionBinding.equals(SESSION_A),
        "device and session"); assertions++;
    check(Arrays.stream(Phone11WakeEnrollmentStore.Binding.class.getDeclaredFields())
        .map(Field::getName).noneMatch("grant"::equals), "grant excluded from public binding"); assertions++;
    check(new Phone11WakeEnrollmentStore(memory).publicBinding(NOW).bindingId.equals(BINDING_A),
        "process recreation"); assertions++;

    int clears = memory.clears;
    check(!store.save(enrollment(BINDING_A, SESSION_A, "short", NOW + 60_000), NOW),
        "bad grant"); assertions++;
    check(memory.clears == clears && store.publicBinding(NOW) != null,
        "invalid save preserves current enrollment"); assertions++;
    check(!store.save(enrollment(BINDING_A, "not-a-uuid", GRANT_A, NOW + 60_000), NOW),
        "bad session"); assertions++;
    check(!store.save(enrollment(BINDING_A, SESSION_A, GRANT_A, NOW), NOW),
        "expired save"); assertions++;
    check(!store.save(enrollment(BINDING_A, SESSION_A, GRANT_A,
        NOW + Phone11WakeEnrollmentStore.MAX_ENROLLMENT_TTL_MS + 1), NOW), "unbounded save"); assertions++;
    check(!store.save(new Phone11WakeEnrollmentStore.Enrollment(BINDING_A, 0, 11,
        "device-a", SESSION_A, NOW + 60_000, GRANT_A), NOW), "bad owner"); assertions++;
    check(!store.save(new Phone11WakeEnrollmentStore.Enrollment(BINDING_A, 7, 11,
        "contains|delimiter", SESSION_A, NOW + 60_000, GRANT_A), NOW), "bad device"); assertions++;

    check(store.save(enrollment(BINDING_B, SESSION_B, GRANT_B, NOW + 90_000), NOW),
        "rotation"); assertions++;
    check(memory.clears == clears + 1, "rotation clears old encrypted value"); assertions++;
    check(store.grant(BINDING_A, NOW) == null && store.grant(BINDING_B, NOW).equals(GRANT_B),
        "old grant unavailable"); assertions++;
    check(store.publicBinding(NOW).bindingId.equals(BINDING_B), "rotated binding"); assertions++;
    check(store.publicBinding(NOW + 90_001) == null && memory.value == null,
        "expiry clears"); assertions++;

    memory.value = "corrupt|private|grant";
    check(store.publicBinding(NOW) == null && memory.value == null, "corrupt fails closed"); assertions++;
    check(store.save(enrollment(BINDING_A, SESSION_A, GRANT_A, NOW + 60_000), NOW),
        "save after corruption"); assertions++;
    store.clear();
    check(store.publicBinding(NOW) == null && memory.value == null, "logout clear"); assertions++;
    System.out.println("PASS: " + assertions
        + " Android wake enrollment assertions (L0; no Firebase token or delivery)");
  }
}
