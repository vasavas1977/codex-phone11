package ai.phone11.siprix;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Sanitized result for the isolated staging app's on-device Firebase check. */
final class Phone11FirebaseDiagnostic {
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
