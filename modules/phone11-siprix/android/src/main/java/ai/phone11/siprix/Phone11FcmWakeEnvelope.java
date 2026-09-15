package ai.phone11.siprix;

import java.util.Map;

/**
 * Strict parser for the data-only FCM call envelope. Firebase authenticates the
 * sender project; the persisted binding supplies local session ownership.
 * Caller details, grants, SIP credentials and arbitrary extra data are refused.
 */
public final class Phone11FcmWakeEnvelope {
  private Phone11FcmWakeEnvelope() {}

  /** Reserves malformed Phone11-looking messages so generic alerts cannot expose them. */
  public static boolean isPhone11(Map<String, String> data) {
    return data != null && (data.containsKey("callUUID") || data.containsKey("bindingId"));
  }

  public static Phone11PendingWakeStore.Wake parse(Map<String, String> data) {
    if (!isPhone11(data) || data.size() != 4
        || !data.containsKey("v") || !data.containsKey("callUUID")
        || !data.containsKey("bindingId") || !data.containsKey("expiresAt")
        || !"1".equals(data.get("v"))) return null;
    try {
      String expiresAt = data.get("expiresAt");
      if (expiresAt == null || !expiresAt.matches("[1-9][0-9]{0,18}")) return null;
      return new Phone11PendingWakeStore.Wake(1, data.get("callUUID"),
          data.get("bindingId"), Long.parseLong(expiresAt));
    } catch (NumberFormatException invalid) {
      return null;
    }
  }
}
