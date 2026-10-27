package ai.phone11.siprix;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Admission and stale-operation fencing only. HTTP authority and SDK ownership remain native responsibilities. */
public final class Phone11AndroidWakeState {
  public enum Phase { IDLE, CLAIMING, CLAIMED, READY, RINGING, ANSWERING, ACTIVE }
  public static final class Binding {
    public final String bindingId, ownerUserId, tenantId, deviceId, sessionBinding;
    public final long expiresAt;
    public Binding(String bindingId, String ownerUserId, String tenantId, String deviceId, String sessionBinding, long expiresAt) {
      if (!uuid(bindingId) || !numericIdentity(ownerUserId) || !numericIdentity(tenantId) ||
          !identifier(deviceId) || !uuid(sessionBinding) || expiresAt <= 0) throw new IllegalArgumentException("Invalid wake binding");
      this.bindingId = bindingId; this.ownerUserId = ownerUserId; this.tenantId = tenantId;
      this.deviceId = deviceId; this.sessionBinding = sessionBinding; this.expiresAt = expiresAt;
    }
    boolean sameIdentity(Binding other) {
      return other != null && bindingId.equals(other.bindingId) && ownerUserId.equals(other.ownerUserId) &&
        tenantId.equals(other.tenantId) && deviceId.equals(other.deviceId) && sessionBinding.equals(other.sessionBinding);
    }
  }
  public static final class Ticket {
    public final long epoch, expiresAt;
    public final String callUUID, bindingId;
    private Ticket(long epoch, String callUUID, String bindingId, long expiresAt) {
      this.epoch = epoch; this.callUUID = callUUID; this.bindingId = bindingId; this.expiresAt = expiresAt;
    }
  }
  private Binding binding;
  private Ticket active;
  private Phase phase = Phase.IDLE;
  private long epoch;
  private final Map<String, Long> consumed = new HashMap<>();
  private static boolean uuid(String value) {
    try { return value != null && UUID.fromString(value).toString().equals(value); }
    catch (IllegalArgumentException error) { return false; }
  }
  private static boolean identifier(String value) {
    return value != null && !value.isEmpty() && value.length() <= 512 && value.chars().noneMatch(c -> c <= 32 || c == 127);
  }
  private static boolean numericIdentity(String value) {
    try { return value != null && value.matches("[1-9][0-9]{0,15}") && Long.parseLong(value) <= 9007199254740991L; }
    catch (NumberFormatException error) { return false; }
  }
  public synchronized void bind(Binding next, long now) {
    Objects.requireNonNull(next);
    if (next.expiresAt <= now) throw new IllegalArgumentException("Expired wake binding");
    if (!next.sameIdentity(binding)) {
      ++epoch; active = null; phase = Phase.IDLE; consumed.clear();
    }
    binding = next;
  }
  public synchronized Ticket receive(String bindingId, String callUUID, long expiresAt, long now) {
    expire(now);
    consumed.entrySet().removeIf(entry -> entry.getValue() <= now);
    if (binding == null || active != null || !binding.bindingId.equals(bindingId) || !uuid(callUUID) ||
        expiresAt <= now || expiresAt > binding.expiresAt || expiresAt - now > 60_000 ||
        consumed.containsKey(callUUID) || consumed.size() >= 64) return null;
    active = new Ticket(++epoch, callUUID, bindingId, expiresAt);
    phase = Phase.CLAIMING;
    return active;
  }
  public synchronized boolean claimed(Ticket ticket, Binding claimIdentity, long now) {
    if (!isCurrent(ticket, now) || phase != Phase.CLAIMING || !binding.sameIdentity(claimIdentity) ||
        claimIdentity.expiresAt != ticket.expiresAt) return false;
    phase = Phase.CLAIMED;
    return true;
  }
  public synchronized boolean ready(Ticket ticket, long now) { return transition(ticket, now, Phase.CLAIMED, Phase.READY); }
  public synchronized boolean ringing(Ticket ticket, long now) { return transition(ticket, now, Phase.READY, Phase.RINGING); }
  public synchronized boolean answer(Ticket ticket, long now) { return transition(ticket, now, Phase.RINGING, Phase.ANSWERING); }
  public synchronized boolean connected(Ticket ticket, long now) { return transition(ticket, now, Phase.ANSWERING, Phase.ACTIVE); }
  private boolean transition(Ticket ticket, long now, Phase from, Phase to) {
    if (!isCurrent(ticket, now) || phase != from) return false;
    phase = to;
    return true;
  }
  public synchronized boolean isCurrent(Ticket ticket, long now) {
    expire(now);
    return ticket != null && ticket == active && ticket.epoch == epoch && binding != null;
  }
  public synchronized boolean end(Ticket ticket, long now) {
    if (ticket == null || ticket != active || ticket.epoch != epoch) return false;
    consumed.put(ticket.callUUID, Math.max(ticket.expiresAt, now + 60_000));
    ++epoch; active = null; phase = Phase.IDLE;
    return true;
  }
  private void expire(long now) {
    if (binding != null && binding.expiresAt <= now) { revoke(); return; }
    if (active != null && phase != Phase.ACTIVE && active.expiresAt <= now) end(active, now);
  }
  public synchronized void revoke() { ++epoch; binding = null; active = null; phase = Phase.IDLE; consumed.clear(); }
  public synchronized Binding binding() { return binding; }
  public synchronized Ticket ticket() { return active; }
  public synchronized Phase phase() { return phase; }
}
