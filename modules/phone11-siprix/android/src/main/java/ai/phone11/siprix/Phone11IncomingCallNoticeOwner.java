package ai.phone11.siprix;

/** Pure ownership checks and stable request codes for incoming-call notice actions. */
final class Phone11IncomingCallNoticeOwner {
  static final int OPEN = 0;
  static final int ANSWER = 1;
  static final int DECLINE = 2;
  static final int FULL_SCREEN = 3;

  private Phone11IncomingCallNoticeOwner() {}

  static boolean ownsPending(Phone11PendingWakeStore.Snapshot snapshot,
      String callUUID, String bindingId) {
    return snapshot != null && snapshot.bound && "pending".equals(snapshot.callState)
        && callUUID != null && callUUID.equals(snapshot.callUUID)
        && bindingId != null && bindingId.equals(snapshot.bindingId);
  }

  static int requestCode(String callUUID, int action) {
    if (callUUID == null || action < OPEN || action > FULL_SCREEN) {
      throw new IllegalArgumentException("incoming-call notice identity");
    }
    return ((callUUID.hashCode() & 0x1fffffff) * 4) + action;
  }

  static boolean clearsNotice(Phone11PendingWakeStore.Decision decision) {
    return decision == Phone11PendingWakeStore.Decision.CANCELLED
        || decision == Phone11PendingWakeStore.Decision.COMPLETED
        || decision == Phone11PendingWakeStore.Decision.REJECTED_EXPIRED
        || decision == Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
  }
}
