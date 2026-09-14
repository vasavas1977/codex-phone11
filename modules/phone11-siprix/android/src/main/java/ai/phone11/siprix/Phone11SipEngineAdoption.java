package ai.phone11.siprix;

import java.util.HashSet;
import java.util.Set;

/**
 * Pure, process-local ownership contract between an authenticated pending wake
 * and the one Siprix engine which is already owned by Phone11SiprixModule.
 * This class never creates an SDK core, account, registration, or network work.
 */
final class Phone11SipEngineAdoption {
  interface Commands {
    boolean answer(int callId);
    boolean decline(int callId);
  }

  enum Decision {
    ADOPTED,
    DUPLICATE,
    ANSWERED,
    DECLINED,
    CLEARED,
    REJECTED_UNAVAILABLE,
    REJECTED_NOT_REGISTERED,
    REJECTED_AMBIGUOUS,
    REJECTED_WRONG_OWNER,
    REJECTED_EXPIRED,
    REJECTED_TERMINAL,
    REJECTED_COMMAND
  }

  private enum OwnerState { RINGING, ANSWERED }

  private static final class Owner {
    final long generation;
    final int accountId;
    final int callId;
    final String callUUID;
    final String bindingId;
    final long expiresAt;
    OwnerState state;

    Owner(long generation, int accountId, int callId, String callUUID, String bindingId,
        long expiresAt) {
      this.generation = generation;
      this.accountId = accountId;
      this.callId = callId;
      this.callUUID = callUUID;
      this.bindingId = bindingId;
      this.expiresAt = expiresAt;
      state = OwnerState.RINGING;
    }
  }

  private long generation = -1;
  private Commands commands;
  private final Set<Integer> registeredAccounts = new HashSet<>();
  private int ringingAccountId = -1;
  private int ringingCallId = -1;
  private Owner owner;

  synchronized void attach(long nextGeneration, Commands nextCommands) {
    if (nextGeneration <= 0 || nextCommands == null) throw new IllegalArgumentException("engine");
    if (generation == nextGeneration && commands == nextCommands) return;
    clearAll();
    generation = nextGeneration;
    commands = nextCommands;
  }

  synchronized void detach(long detachedGeneration) {
    if (generation != detachedGeneration) return;
    clearAll();
    generation = -1;
    commands = null;
  }

  synchronized void accountRegistration(long eventGeneration, int accountId, boolean registered) {
    if (!available(eventGeneration) || accountId < 0) return;
    if (registered) registeredAccounts.add(accountId);
    else registeredAccounts.remove(accountId);
    if (owner != null && owner.accountId == accountId && !registered) owner = null;
  }

  synchronized void incoming(long eventGeneration, int accountId, int callId) {
    if (!available(eventGeneration) || accountId < 0 || callId < 0) return;
    if (owner != null && (owner.callId != callId || owner.accountId != accountId)) return;
    ringingAccountId = accountId;
    ringingCallId = callId;
  }

  synchronized Decision adopt(Phone11PendingWakeStore.Snapshot wake, long now) {
    expire(now);
    if (commands == null || generation <= 0 || !ownsPending(wake)) {
      return Decision.REJECTED_UNAVAILABLE;
    }
    if (wake.callExpiresAt <= now) return Decision.REJECTED_EXPIRED;
    if (owner != null) {
      return sameOwner(owner, wake) ? Decision.DUPLICATE : Decision.REJECTED_WRONG_OWNER;
    }
    if (registeredAccounts.size() != 1) return Decision.REJECTED_NOT_REGISTERED;
    if (ringingCallId < 0 || ringingAccountId < 0) return Decision.REJECTED_AMBIGUOUS;
    if (!registeredAccounts.contains(ringingAccountId)) return Decision.REJECTED_NOT_REGISTERED;
    owner = new Owner(generation, ringingAccountId, ringingCallId, wake.callUUID,
        wake.bindingId, wake.callExpiresAt);
    return Decision.ADOPTED;
  }

  synchronized Decision answer(String callUUID, String bindingId, long now) {
    if (owner != null && owner.expiresAt <= now) {
      expire(now);
      return Decision.REJECTED_EXPIRED;
    }
    if (!sameOwner(owner, callUUID, bindingId)) return missingOwner();
    if (owner.state != OwnerState.RINGING) return Decision.REJECTED_TERMINAL;
    if (!available(owner.generation) || !commands.answer(owner.callId)) {
      return Decision.REJECTED_COMMAND;
    }
    owner.state = OwnerState.ANSWERED;
    ringingAccountId = -1;
    ringingCallId = -1;
    return Decision.ANSWERED;
  }

  synchronized Decision decline(String callUUID, String bindingId, long now) {
    if (owner != null && owner.expiresAt <= now) {
      expire(now);
      return Decision.REJECTED_EXPIRED;
    }
    if (!sameOwner(owner, callUUID, bindingId)) return missingOwner();
    if (owner.state != OwnerState.RINGING) return Decision.REJECTED_TERMINAL;
    if (!available(owner.generation) || !commands.decline(owner.callId)) {
      return Decision.REJECTED_COMMAND;
    }
    owner = null;
    ringingAccountId = -1;
    ringingCallId = -1;
    return Decision.DECLINED;
  }

  synchronized Decision cancel(String callUUID, String bindingId, long now) {
    if (owner != null && owner.expiresAt <= now) {
      expire(now);
      return Decision.REJECTED_EXPIRED;
    }
    if (!sameOwner(owner, callUUID, bindingId)) return missingOwner();
    if (owner.state == OwnerState.RINGING && available(owner.generation)) {
      commands.decline(owner.callId);
    }
    owner = null;
    ringingAccountId = -1;
    ringingCallId = -1;
    return Decision.CLEARED;
  }

  synchronized void terminated(long eventGeneration, int callId) {
    if (!available(eventGeneration)) return;
    if (ringingCallId == callId) {
      ringingAccountId = -1;
      ringingCallId = -1;
    }
    if (owner != null && owner.generation == eventGeneration && owner.callId == callId) {
      owner = null;
    }
  }

  synchronized void logout() {
    if (owner != null && owner.state == OwnerState.RINGING && available(owner.generation)) {
      commands.decline(owner.callId);
    }
    clearAll();
  }

  synchronized Decision cleanupExpired(long now) {
    if (owner == null || owner.expiresAt > now) return Decision.REJECTED_WRONG_OWNER;
    expire(now);
    return Decision.CLEARED;
  }

  private void expire(long now) {
    if (owner != null && owner.expiresAt <= now) {
      if (owner.state == OwnerState.RINGING && available(owner.generation)) {
        commands.decline(owner.callId);
      }
      owner = null;
      ringingAccountId = -1;
      ringingCallId = -1;
    }
  }

  private Decision missingOwner() {
    return commands == null || generation <= 0 ? Decision.REJECTED_UNAVAILABLE
        : Decision.REJECTED_WRONG_OWNER;
  }

  private boolean available(long expectedGeneration) {
    return commands != null && generation == expectedGeneration;
  }

  private static boolean ownsPending(Phone11PendingWakeStore.Snapshot wake) {
    return wake != null && wake.bound && "pending".equals(wake.callState)
        && wake.callUUID != null && wake.bindingId != null;
  }

  private static boolean sameOwner(Owner current, Phone11PendingWakeStore.Snapshot wake) {
    return current != null && sameOwner(current, wake.callUUID, wake.bindingId)
        && current.expiresAt == wake.callExpiresAt;
  }

  private static boolean sameOwner(Owner current, String callUUID, String bindingId) {
    return current != null && callUUID != null && callUUID.equals(current.callUUID)
        && bindingId != null && bindingId.equals(current.bindingId);
  }

  private void clearAll() {
    owner = null;
    registeredAccounts.clear();
    ringingAccountId = -1;
    ringingCallId = -1;
  }
}
