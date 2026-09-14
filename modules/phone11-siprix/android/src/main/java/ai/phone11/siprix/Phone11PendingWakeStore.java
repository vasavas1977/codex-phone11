package ai.phone11.siprix;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Persistent, single-call ownership state for a future authenticated Android
 * push ingress. This class performs no network, SIP, audio, or UI work.
 */
public final class Phone11PendingWakeStore {
  public static final long MAX_WAKE_TTL_MS = 120_000L;
  private static final Pattern UUID = Pattern.compile(
      "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern OPAQUE = Pattern.compile("^[A-Za-z0-9._~-]{1,128}$");

  public interface Persistence {
    String read();
    void write(String value);
    void clear();
  }

  public enum Decision {
    ACCEPTED,
    DUPLICATE,
    CANCELLED,
    COMPLETED,
    REJECTED_MALFORMED,
    REJECTED_EXPIRED,
    REJECTED_WRONG_BINDING,
    REJECTED_LOGGED_OUT,
    REJECTED_BUSY,
    REJECTED_CANCELLED
  }

  public static final class Binding {
    public final String bindingId;
    public final long ownerUserId;
    public final long tenantId;
    public final String deviceId;
    public final String sessionBinding;
    public final long expiresAt;

    public Binding(String bindingId, long ownerUserId, long tenantId, String deviceId,
        String sessionBinding, long expiresAt) {
      this.bindingId = bindingId;
      this.ownerUserId = ownerUserId;
      this.tenantId = tenantId;
      this.deviceId = deviceId;
      this.sessionBinding = sessionBinding;
      this.expiresAt = expiresAt;
    }
  }

  public static final class Wake {
    public final int version;
    public final String callUUID;
    public final String bindingId;
    public final long expiresAt;

    public Wake(int version, String callUUID, String bindingId, long expiresAt) {
      this.version = version;
      this.callUUID = callUUID;
      this.bindingId = bindingId;
      this.expiresAt = expiresAt;
    }
  }

  public static final class Snapshot {
    public final boolean bound;
    public final String bindingId;
    public final String callUUID;
    public final String callState;

    Snapshot(State state) {
      bound = state.binding != null;
      bindingId = state.binding == null ? null : state.binding.bindingId;
      callUUID = state.call == null ? null : state.call.callUUID;
      callState = state.call == null ? null : state.call.state.name().toLowerCase(Locale.ROOT);
    }
  }

  private enum CallState { PENDING, CANCELLED, COMPLETED }

  private static final class PendingCall {
    final String callUUID;
    final String bindingId;
    final long expiresAt;
    final CallState state;

    PendingCall(String callUUID, String bindingId, long expiresAt, CallState state) {
      this.callUUID = callUUID;
      this.bindingId = bindingId;
      this.expiresAt = expiresAt;
      this.state = state;
    }
  }

  private static final class State {
    Binding binding;
    PendingCall call;
  }

  private final Persistence persistence;

  public Phone11PendingWakeStore(Persistence persistence) {
    if (persistence == null) throw new IllegalArgumentException("persistence");
    this.persistence = persistence;
  }

  public synchronized Decision bind(Binding binding, long now) {
    if (!valid(binding) || binding.expiresAt <= now) return Decision.REJECTED_MALFORMED;
    Binding persisted = new Binding(binding.bindingId, binding.ownerUserId, binding.tenantId,
        digest(binding.deviceId), digest(binding.sessionBinding), binding.expiresAt);
    State state = load();
    boolean sameOwner = state.binding != null
        && state.binding.ownerUserId == persisted.ownerUserId
        && state.binding.tenantId == persisted.tenantId
        && state.binding.deviceId.equals(persisted.deviceId)
        && state.binding.sessionBinding.equals(persisted.sessionBinding)
        && state.binding.bindingId.equals(persisted.bindingId);
    state.binding = persisted;
    if (!sameOwner) state.call = null;
    save(state);
    return Decision.ACCEPTED;
  }

  public synchronized Decision receive(Wake wake, long now) {
    if (!valid(wake, now)) return Decision.REJECTED_MALFORMED;
    State state = load();
    Decision owner = ownerDecision(state, wake.bindingId, now);
    if (owner != null) return owner;
    if (wake.expiresAt <= now) return Decision.REJECTED_EXPIRED;
    if (state.call != null && state.call.expiresAt <= now) state.call = null;
    if (state.call != null) {
      if (state.call.callUUID.equals(wake.callUUID) && state.call.bindingId.equals(wake.bindingId)) {
        if (state.call.state == CallState.CANCELLED) return Decision.REJECTED_CANCELLED;
        return Decision.DUPLICATE;
      }
      if (state.call.state == CallState.PENDING) return Decision.REJECTED_BUSY;
    }
    state.call = new PendingCall(wake.callUUID, wake.bindingId, wake.expiresAt, CallState.PENDING);
    save(state);
    return Decision.ACCEPTED;
  }

  /** A terminal event may arrive before its wake, so cancellation is tombstoned. */
  public synchronized Decision cancel(Wake wake, long now) {
    if (!valid(wake, now)) return Decision.REJECTED_MALFORMED;
    State state = load();
    Decision owner = ownerDecision(state, wake.bindingId, now);
    if (owner != null) return owner;
    if (wake.expiresAt <= now) return Decision.REJECTED_EXPIRED;
    if (state.call != null && state.call.expiresAt > now
        && !state.call.callUUID.equals(wake.callUUID) && state.call.state == CallState.PENDING) {
      return Decision.REJECTED_BUSY;
    }
    state.call = new PendingCall(wake.callUUID, wake.bindingId, wake.expiresAt, CallState.CANCELLED);
    save(state);
    return Decision.CANCELLED;
  }

  public synchronized Decision complete(String callUUID, long now) {
    if (!uuid(callUUID)) return Decision.REJECTED_MALFORMED;
    State state = load();
    if (state.binding == null) return Decision.REJECTED_LOGGED_OUT;
    if (state.binding.expiresAt <= now) {
      persistence.clear();
      return Decision.REJECTED_EXPIRED;
    }
    if (state.call == null || !state.call.callUUID.equals(callUUID)) return Decision.REJECTED_WRONG_BINDING;
    state.call = new PendingCall(state.call.callUUID, state.call.bindingId,
        state.call.expiresAt, CallState.COMPLETED);
    save(state);
    return Decision.COMPLETED;
  }

  /** Logout or account replacement removes both the binding and any call data. */
  public synchronized void logout() {
    persistence.clear();
  }

  public synchronized Snapshot snapshot() {
    return new Snapshot(load());
  }

  private Decision ownerDecision(State state, String bindingId, long now) {
    if (state.binding == null) return Decision.REJECTED_LOGGED_OUT;
    if (state.binding.expiresAt <= now) {
      persistence.clear();
      return Decision.REJECTED_EXPIRED;
    }
    return state.binding.bindingId.equals(bindingId) ? null : Decision.REJECTED_WRONG_BINDING;
  }

  private static boolean valid(Binding binding) {
    return binding != null && uuid(binding.bindingId) && binding.ownerUserId > 0 && binding.tenantId > 0
        && opaque(binding.deviceId) && opaque(binding.sessionBinding) && binding.expiresAt > 0;
  }

  private static boolean valid(Wake wake, long now) {
    return wake != null && wake.version == 1 && uuid(wake.callUUID) && uuid(wake.bindingId)
        && wake.expiresAt > 0 && wake.expiresAt <= now + MAX_WAKE_TTL_MS;
  }

  private static boolean uuid(String value) { return value != null && UUID.matcher(value).matches(); }
  private static boolean opaque(String value) { return value != null && OPAQUE.matcher(value).matches(); }

  private static String digest(String value) {
    try {
      byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder(bytes.length * 2);
      for (byte item : bytes) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
      return result.toString();
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 unavailable", impossible);
    }
  }

  private State load() {
    String raw = persistence.read();
    if (raw == null || raw.isEmpty()) return new State();
    try {
      State state = new State();
      for (String line : raw.split("\\n")) {
        String[] values = line.split("\\|", -1);
        if (values.length == 7 && "B1".equals(values[0])) {
          state.binding = new Binding(values[1], Long.parseLong(values[2]), Long.parseLong(values[3]),
              values[4], values[5], Long.parseLong(values[6]));
          if (!valid(state.binding)) throw new IllegalArgumentException("binding");
        } else if (values.length == 5 && "C1".equals(values[0])) {
          state.call = new PendingCall(values[1], values[2], Long.parseLong(values[3]),
              CallState.valueOf(values[4]));
          if (!uuid(state.call.callUUID) || !uuid(state.call.bindingId) || state.call.expiresAt <= 0) {
            throw new IllegalArgumentException("call");
          }
        } else {
          throw new IllegalArgumentException("format");
        }
      }
      if (state.call != null && state.binding == null) throw new IllegalArgumentException("orphan");
      return state;
    } catch (RuntimeException corrupt) {
      persistence.clear();
      return new State();
    }
  }

  private void save(State state) {
    if (state.binding == null) {
      persistence.clear();
      return;
    }
    StringBuilder out = new StringBuilder("B1|")
        .append(state.binding.bindingId).append('|')
        .append(state.binding.ownerUserId).append('|')
        .append(state.binding.tenantId).append('|')
        .append(state.binding.deviceId).append('|')
        .append(state.binding.sessionBinding).append('|')
        .append(state.binding.expiresAt);
    if (state.call != null) {
      out.append("\nC1|").append(state.call.callUUID).append('|')
          .append(state.call.bindingId).append('|').append(state.call.expiresAt).append('|')
          .append(state.call.state.name());
    }
    persistence.write(out.toString());
  }
}
