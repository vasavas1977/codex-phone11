package ai.phone11.siprix;

import android.content.Context;
import android.content.SharedPreferences;

/** Persists only the non-secret outcome of the staging Firebase check. */
final class Phone11FirebaseDiagnosticStore {
  private final SharedPreferences preferences;

  Phone11FirebaseDiagnosticStore(Context context) {
    preferences = context.getSharedPreferences("phone11_firebase_diagnostic_v1", Context.MODE_PRIVATE);
  }

  synchronized void replace(Phone11FirebaseDiagnostic.Result value) {
    SharedPreferences.Editor editor = preferences.edit()
        .putString("status", value.status)
        .putBoolean("present", value.tokenPresent)
        .putString("reason", value.reason)
        .putLong("checked_at", value.checkedAt);
    if (value.tokenHash == null) editor.remove("fingerprint");
    else editor.putString("fingerprint", value.tokenHash);
    if (!editor.commit()) throw new IllegalStateException("Firebase diagnostic persistence failed");
  }

  synchronized void recordIngress(long receivedAt, boolean envelopeShapeValid,
      Phone11FirebaseDiagnostic.ReceiptReason reason) {
    Phone11FirebaseDiagnostic.IngressReceipt next = Phone11FirebaseDiagnostic.nextIngress(
        readIngress(), receivedAt, envelopeShapeValid, reason);
    if (!preferences.edit()
        .putLong("ingress_count", next.receiptCount)
        .putLong("ingress_received_at", next.receivedAt)
        .putBoolean("ingress_shape_valid", next.envelopeShapeValid)
        .putString("ingress_decision", next.decision)
        .putString("ingress_reason", next.reason)
        .commit()) throw new IllegalStateException("Firebase ingress diagnostic persistence failed");
  }

  synchronized Phone11FirebaseDiagnostic.IngressReceipt readIngress() {
    return Phone11FirebaseDiagnostic.restoreIngress(
        preferences.getLong("ingress_count", 0),
        preferences.getLong("ingress_received_at", 0),
        preferences.getBoolean("ingress_shape_valid", false),
        preferences.getString("ingress_decision", null),
        preferences.getString("ingress_reason", null));
  }
}
