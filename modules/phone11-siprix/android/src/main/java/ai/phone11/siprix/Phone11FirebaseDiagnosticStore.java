package ai.phone11.siprix;

import android.content.Context;
import android.content.SharedPreferences;

/** Persists only the non-secret outcome of the staging Firebase check. */
final class Phone11FirebaseDiagnosticStore {
  private final SharedPreferences preferences;

  Phone11FirebaseDiagnosticStore(Context context) {
    preferences = context.getSharedPreferences("phone11_firebase_diagnostic_v1", Context.MODE_PRIVATE);
  }

  void replace(Phone11FirebaseDiagnostic.Result value) {
    SharedPreferences.Editor editor = preferences.edit().clear()
        .putString("status", value.status)
        .putBoolean("present", value.tokenPresent)
        .putString("reason", value.reason)
        .putLong("checked_at", value.checkedAt);
    if (value.tokenHash != null) editor.putString("fingerprint", value.tokenHash);
    if (!editor.commit()) throw new IllegalStateException("Firebase diagnostic persistence failed");
  }
}
