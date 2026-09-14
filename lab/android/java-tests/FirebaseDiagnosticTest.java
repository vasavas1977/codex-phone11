package ai.phone11.siprix;

import java.util.Map;

public final class FirebaseDiagnosticTest {
  private static int assertions;

  private static void check(boolean value) {
    assertions++;
    if (!value) throw new AssertionError("assertion " + assertions + " failed");
  }

  public static void main(String[] args) {
    long now = 1700000000123L;
    Phone11FirebaseDiagnostic.Result unavailable = Phone11FirebaseDiagnostic.unavailable(now);
    check("unavailable".equals(unavailable.status));
    check(!unavailable.tokenPresent);
    check(unavailable.tokenHash == null);
    check("native_wake_not_commissioned".equals(unavailable.reason));

    Phone11FirebaseDiagnostic.Result misconfigured = Phone11FirebaseDiagnostic.misconfigured(now);
    check("blocked".equals(misconfigured.status));
    check(!misconfigured.tokenPresent);
    check(misconfigured.tokenHash == null);
    check("android_wake_misconfigured".equals(misconfigured.reason));

    String providerValue = "provider-value-that-must-never-be-persisted-or-shown";
    Phone11FirebaseDiagnostic.Result available = Phone11FirebaseDiagnostic.fromProviderValue(providerValue, now);
    Phone11FirebaseDiagnostic.Result repeat = Phone11FirebaseDiagnostic.fromProviderValue(providerValue, now + 1);
    Phone11FirebaseDiagnostic.Result other = Phone11FirebaseDiagnostic.fromProviderValue(providerValue + "-rotated", now);
    check("available".equals(available.status));
    check(available.tokenPresent);
    check(available.tokenHash.matches("[0-9a-f]{16}"));
    check(available.tokenHash.equals(repeat.tokenHash));
    check(!available.tokenHash.equals(other.tokenHash));
    check(!available.tokenHash.contains(providerValue));

    Map<String, Object> publicValue = available.publicValue();
    check(publicValue.size() == 5);
    check(Boolean.TRUE.equals(publicValue.get("tokenPresent")));
    check(available.tokenHash.equals(publicValue.get("tokenHash")));
    check(!publicValue.toString().contains(providerValue));
    check(Double.valueOf(now).equals(publicValue.get("checkedAt")));

    for (String invalid : new String[] {"", "   "}) {
      Phone11FirebaseDiagnostic.Result result = Phone11FirebaseDiagnostic.fromProviderValue(invalid, now);
      check("blocked".equals(result.status));
      check(!result.tokenPresent);
      check(result.tokenHash == null);
    }
    Phone11FirebaseDiagnostic.Result missing = Phone11FirebaseDiagnostic.fromProviderValue(null, now);
    check("blocked".equals(missing.status));
    check(!missing.tokenPresent);
    check(missing.tokenHash == null);

    Phone11FirebaseDiagnostic.IngressReceipt invalid = Phone11FirebaseDiagnostic.nextIngress(
        null, now, false, Phone11FirebaseDiagnostic.ReceiptReason.INVALID_ENVELOPE);
    check(invalid.receiptCount == 1);
    check(invalid.receivedAt == now);
    check(!invalid.envelopeShapeValid);
    check("rejected".equals(invalid.decision));
    check("envelope_shape_invalid".equals(invalid.reason));

    Phone11FirebaseDiagnostic.IngressReceipt accepted = Phone11FirebaseDiagnostic.nextIngress(
        invalid, now + 1, true, Phone11FirebaseDiagnostic.ReceiptReason.from(
            Phone11PendingWakeStore.Decision.ACCEPTED));
    check(accepted.receiptCount == 2);
    check(accepted.envelopeShapeValid);
    check("accepted".equals(accepted.decision));
    check("accepted".equals(accepted.reason));
    Map<String, Object> ingressValue = accepted.publicValue();
    check(ingressValue.size() == 5);
    check(!ingressValue.containsKey("callUUID") && !ingressValue.containsKey("bindingId"));
    check(!ingressValue.containsKey("token") && !ingressValue.containsKey("tokenHash"));

    Phone11FirebaseDiagnostic.IngressReceipt capped = Phone11FirebaseDiagnostic.nextIngress(
        new Phone11FirebaseDiagnostic.IngressReceipt(Phone11FirebaseDiagnostic.MAX_RECEIPT_COUNT,
            now, true, "accepted", "accepted"),
        now + 2, true, Phone11FirebaseDiagnostic.ReceiptReason.DUPLICATE);
    check(capped.receiptCount == Phone11FirebaseDiagnostic.MAX_RECEIPT_COUNT);
    check("ignored".equals(capped.decision));
    check("duplicate".equals(capped.reason));

    check(Phone11FirebaseDiagnostic.restoreIngress(2, now, true, "accepted", "accepted") != null);
    check(Phone11FirebaseDiagnostic.restoreIngress(0, now, true, "accepted", "accepted") == null);
    check(Phone11FirebaseDiagnostic.restoreIngress(2, now, true, "accepted", "unknown") == null);

    System.out.println("PASS: " + assertions + " sanitized Firebase diagnostic assertions");
  }
}
