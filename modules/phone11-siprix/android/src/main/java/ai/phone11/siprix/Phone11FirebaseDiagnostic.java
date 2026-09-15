package ai.phone11.siprix;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Sanitized result for the isolated staging app's on-device Firebase check. */
final class Phone11FirebaseDiagnostic {
  static final long MAX_RECEIPT_COUNT = 1000;
  static final String AVAILABLE = "available";
  static final String BLOCKED = "blocked";
  static final String UNAVAILABLE = "unavailable";

  static final class Result {
    final String status;
    final boolean tokenPresent;
    final String tokenHash;
    final String reason;
    final long checkedAt;

    Result(String status, boolean tokenPresent, String tokenHash, String reason, long checkedAt) {
      this.status = status;
      this.tokenPresent = tokenPresent;
      this.tokenHash = tokenHash;
      this.reason = reason;
      this.checkedAt = checkedAt;
    }

    Map<String, Object> publicValue() {
      Map<String, Object> value = new LinkedHashMap<>();
      value.put("status", status);
      value.put("tokenPresent", tokenPresent);
      value.put("tokenHash", tokenHash);
      value.put("reason", reason);
      value.put("checkedAt", (double) checkedAt);
      return value;
    }
  }

  enum ReceiptReason {
    ACCEPTED("accepted", "accepted"),
    DUPLICATE("ignored", "duplicate"),
    CANCELLED("ignored", "cancelled"),
    COMPLETED("ignored", "completed"),
    REJECTED_MALFORMED("rejected", "rejected_malformed"),
    REJECTED_EXPIRED("rejected", "rejected_expired"),
    REJECTED_WRONG_BINDING("rejected", "rejected_wrong_binding"),
    REJECTED_LOGGED_OUT("rejected", "rejected_logged_out"),
    REJECTED_BUSY("rejected", "rejected_busy"),
    REJECTED_CANCELLED("rejected", "rejected_cancelled"),
    NOT_DATA_ONLY("rejected", "notification_payload"),
    INVALID_ENVELOPE("rejected", "envelope_shape_invalid");

    final String decision;
    final String publicReason;

    ReceiptReason(String decision, String publicReason) {
      this.decision = decision;
      this.publicReason = publicReason;
    }

    static ReceiptReason from(Phone11PendingWakeStore.Decision decision) {
      return ReceiptReason.valueOf(decision.name());
    }
  }

  static final class IngressReceipt {
    final long receiptCount;
    final long receivedAt;
    final boolean envelopeShapeValid;
    final String decision;
    final String reason;

    IngressReceipt(long receiptCount, long receivedAt, boolean envelopeShapeValid,
        String decision, String reason) {
      this.receiptCount = receiptCount;
      this.receivedAt = receivedAt;
      this.envelopeShapeValid = envelopeShapeValid;
      this.decision = decision;
      this.reason = reason;
    }

    Map<String, Object> publicValue() {
      Map<String, Object> value = new LinkedHashMap<>();
      value.put("receiptCount", (double) receiptCount);
      value.put("receivedAt", (double) receivedAt);
      value.put("envelopeShapeValid", envelopeShapeValid);
      value.put("decision", decision);
      value.put("reason", reason);
      return value;
    }
  }

  static IngressReceipt nextIngress(IngressReceipt previous, long receivedAt,
      boolean envelopeShapeValid, ReceiptReason reason) {
    long previousCount = previous == null ? 0 : previous.receiptCount;
    long count = previousCount >= MAX_RECEIPT_COUNT
        ? MAX_RECEIPT_COUNT : Math.max(0, previousCount) + 1;
    return new IngressReceipt(count, Math.max(0, receivedAt), envelopeShapeValid,
        reason.decision, reason.publicReason);
  }

  static IngressReceipt restoreIngress(long count, long receivedAt, boolean envelopeShapeValid,
      String decision, String reason) {
    if (count < 1 || count > MAX_RECEIPT_COUNT || receivedAt < 1) return null;
    for (ReceiptReason candidate : ReceiptReason.values()) {
      if (candidate.decision.equals(decision) && candidate.publicReason.equals(reason)) {
        return new IngressReceipt(count, receivedAt, envelopeShapeValid, decision, reason);
      }
    }
    return null;
  }

  static Result unavailable(long checkedAt) {
    return new Result(UNAVAILABLE, false, null, "native_wake_not_commissioned", checkedAt);
  }

  static Result misconfigured(long checkedAt) {
    return new Result(BLOCKED, false, null, "android_wake_misconfigured", checkedAt);
  }

  static Result providerUnavailable(long checkedAt) {
    return new Result(BLOCKED, false, null, "firebase_token_unavailable", checkedAt);
  }

  static Result fromProviderValue(String providerValue, long checkedAt) {
    if (providerValue == null || providerValue.trim().isEmpty() || providerValue.length() > 4096) {
      return providerUnavailable(checkedAt);
    }
    return new Result(AVAILABLE, true, fingerprint(providerValue), "firebase_token_available", checkedAt);
  }

  private static String fingerprint(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder output = new StringBuilder(16);
      for (int index = 0; index < 8; index++) {
        output.append(Character.forDigit((digest[index] >>> 4) & 0x0f, 16));
        output.append(Character.forDigit(digest[index] & 0x0f, 16));
      }
      return output.toString();
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 unavailable", impossible);
    }
  }

  private Phone11FirebaseDiagnostic() {}
}
