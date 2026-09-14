package ai.phone11.siprix;

import java.util.regex.Pattern;

/**
 * Validated device-local wake enrollment. The persistence supplied by Android
 * encrypts the serialized grant; publicBinding never returns that grant.
 */
public final class Phone11WakeEnrollmentStore {
  static final long MAX_ENROLLMENT_TTL_MS = 7L * 24L * 60L * 60L * 1000L;
  private static final Pattern UUID = Pattern.compile(
      "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern DEVICE = Pattern.compile("^[A-Za-z0-9._~-]{1,256}$");
  private static final Pattern GRANT = Pattern.compile("^[A-Za-z0-9_-]{43}$");

  public interface Persistence {
    String read();
    void write(String value);
    void clear();
  }

  public static class Binding {
    public final String bindingId;
    public final long ownerUserId;
    public final long tenantId;
    public final String deviceId;
    public final String sessionBinding;
    public final long expiresAt;

    Binding(String bindingId, long ownerUserId, long tenantId, String deviceId,
        String sessionBinding, long expiresAt) {
      this.bindingId = bindingId;
      this.ownerUserId = ownerUserId;
      this.tenantId = tenantId;
      this.deviceId = deviceId;
      this.sessionBinding = sessionBinding;
      this.expiresAt = expiresAt;
    }
  }

  public static final class Enrollment extends Binding {
    final String grant;

    public Enrollment(String bindingId, long ownerUserId, long tenantId, String deviceId,
        String sessionBinding, long expiresAt, String grant) {
      super(bindingId, ownerUserId, tenantId, deviceId, sessionBinding, expiresAt);
      this.grant = grant;
    }
  }

  private final Persistence persistence;

  public Phone11WakeEnrollmentStore(Persistence persistence) {
    if (persistence == null) throw new IllegalArgumentException("persistence");
    this.persistence = persistence;
  }

  public synchronized boolean save(Enrollment value, long now) {
    if (!valid(value, now)) return false;
    Enrollment previous = read();
    if (previous != null && !sameIdentity(previous, value)) persistence.clear();
    persistence.write(serialize(value));
    return true;
  }

  public synchronized Binding publicBinding(long now) {
    Enrollment value = read();
    if (value == null) return null;
    if (value.expiresAt <= now) {
      persistence.clear();
      return null;
    }
    return new Binding(value.bindingId, value.ownerUserId, value.tenantId, value.deviceId,
        value.sessionBinding, value.expiresAt);
  }

  synchronized String grant(String bindingId, long now) {
    Enrollment value = read();
    if (value == null || value.expiresAt <= now || !value.bindingId.equals(bindingId)) {
      if (value != null && value.expiresAt <= now) persistence.clear();
      return null;
    }
    return value.grant;
  }

  public synchronized void clear() { persistence.clear(); }

  static boolean valid(Enrollment value, long now) {
    return value != null && uuid(value.bindingId) && uuid(value.sessionBinding)
        && value.ownerUserId > 0 && value.tenantId > 0 && DEVICE.matcher(value.deviceId).matches()
        && GRANT.matcher(value.grant).matches() && value.expiresAt > now
        && value.expiresAt <= now + MAX_ENROLLMENT_TTL_MS;
  }

  private static boolean sameIdentity(Binding left, Binding right) {
    return left.bindingId.equals(right.bindingId) && left.ownerUserId == right.ownerUserId
        && left.tenantId == right.tenantId && left.deviceId.equals(right.deviceId)
        && left.sessionBinding.equals(right.sessionBinding);
  }

  private Enrollment read() {
    String raw = persistence.read();
    if (raw == null || raw.isEmpty()) return null;
    try {
      String[] fields = raw.split("\\|", -1);
      if (fields.length != 8 || !"E1".equals(fields[0])) throw new IllegalArgumentException();
      Enrollment value = new Enrollment(fields[1], Long.parseLong(fields[2]),
          Long.parseLong(fields[3]), fields[4], fields[5], Long.parseLong(fields[6]), fields[7]);
      if (!valid(value, Math.max(0L, value.expiresAt - MAX_ENROLLMENT_TTL_MS))) {
        throw new IllegalArgumentException();
      }
      return value;
    } catch (RuntimeException corrupt) {
      persistence.clear();
      return null;
    }
  }

  private static String serialize(Enrollment value) {
    return "E1|" + value.bindingId + '|' + value.ownerUserId + '|' + value.tenantId + '|'
        + value.deviceId + '|' + value.sessionBinding + '|' + value.expiresAt + '|' + value.grant;
  }

  private static boolean uuid(String value) {
    return value != null && UUID.matcher(value).matches();
  }
}
