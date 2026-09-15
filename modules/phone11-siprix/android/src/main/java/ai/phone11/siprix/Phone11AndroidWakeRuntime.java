package ai.phone11.siprix;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

/** Process entry point shared by the future FCM adapter and the notification service. */
public final class Phone11AndroidWakeRuntime {
  static final String META_COMMISSIONED = "ai.phone11.androidWakeCommissioned";
  static final String META_ENVIRONMENT = "ai.phone11.androidWakeEnvironment";
  private static final String COMMISSIONED_STAGING_PACKAGE = "ai.phone11.mobile.staging";
  private static Phone11AndroidWakeRuntime instance;

  public enum Status {
    UNSUPPORTED_UNCOMMISSIONED,
    UNSUPPORTED_MISCONFIGURED,
    COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS
  }

  private final Status status;
  private final Phone11PendingWakeStore store;
  private final Phone11WakeEnrollmentStore enrollment;
  private boolean tokenUpdatesStarted;
  private long tokenRevision;

  public static synchronized Phone11AndroidWakeRuntime get(Context context) {
    if (instance == null) instance = new Phone11AndroidWakeRuntime(context.getApplicationContext());
    return instance;
  }

  Phone11AndroidWakeRuntime(Context context) {
    status = readStatus(context);
    SharedPreferences preferences = context.getSharedPreferences("phone11_android_wake_v1", Context.MODE_PRIVATE);
    store = new Phone11PendingWakeStore(new Phone11PendingWakeStore.Persistence() {
      public String read() { return preferences.getString("state", null); }
      public void write(String value) {
        if (!preferences.edit().putString("state", value).commit()) throw new IllegalStateException("wake persistence failed");
      }
      public void clear() {
        if (!preferences.edit().remove("state").commit()) throw new IllegalStateException("wake persistence failed");
      }
    });
    enrollment = new Phone11WakeEnrollmentStore(
        new Phone11EncryptedWakeEnrollmentPersistence(context));
    if (status != Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS) logout();
  }

  public Status status() { return status; }

  public Phone11PendingWakeStore.Decision bind(Phone11PendingWakeStore.Binding binding, long now) {
    if (!commissioned()) return Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
    return store.bind(binding, now);
  }

  public synchronized Phone11PendingWakeStore.Decision saveEnrollment(
      Phone11WakeEnrollmentStore.Enrollment value, long now) {
    if (!commissioned()) return Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
    if (!Phone11WakeEnrollmentStore.valid(value, now)) {
      return Phone11PendingWakeStore.Decision.REJECTED_MALFORMED;
    }
    Phone11PendingWakeStore.Snapshot current = store.snapshot();
    if ("pending".equals(current.callState) && !value.bindingId.equals(current.bindingId)) {
      return Phone11PendingWakeStore.Decision.REJECTED_BUSY;
    }
    Phone11PendingWakeStore.Decision decision = store.bind(new Phone11PendingWakeStore.Binding(
        value.bindingId, value.ownerUserId, value.tenantId, value.deviceId,
        value.sessionBinding, value.expiresAt), now);
    if (decision != Phone11PendingWakeStore.Decision.ACCEPTED) return decision;
    try {
      if (!enrollment.save(value, now)) throw new IllegalStateException("invalid enrollment");
      return decision;
    } catch (RuntimeException failure) {
      store.logout(); enrollment.clear();
      throw failure;
    }
  }

  public synchronized Phone11WakeEnrollmentStore.Binding wakeBinding(long now) {
    if (!commissioned()) return null;
    Phone11WakeEnrollmentStore.Binding value = enrollment.publicBinding(now);
    Phone11PendingWakeStore.Snapshot persisted = store.snapshot();
    if (value == null || !persisted.bound || !value.bindingId.equals(persisted.bindingId)) {
      store.logout(); enrollment.clear();
      return null;
    }
    return value;
  }

  public Phone11PendingWakeStore.Decision receive(Bundle data, long now) {
    return receive(wake(data), now);
  }

  public Phone11PendingWakeStore.Decision receive(Phone11PendingWakeStore.Wake wake, long now) {
    if (!commissioned()) return Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
    return store.receive(wake, now);
  }

  public Phone11PendingWakeStore.Decision cancel(Bundle data, long now) {
    if (!commissioned()) return Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
    return store.cancel(wake(data), now);
  }

  public Phone11PendingWakeStore.Decision complete(String callUUID, long now) {
    if (!commissioned()) return Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
    return store.complete(callUUID, now);
  }

  public synchronized void logout() {
    tokenUpdatesStarted = false; ++tokenRevision;
    store.logout(); enrollment.clear();
  }

  public synchronized long startTokenUpdates() {
    if (!commissioned()) throw new IllegalStateException("wake enrollment unavailable");
    tokenUpdatesStarted = true;
    return ++tokenRevision;
  }

  public synchronized long currentTokenRevision() { return tokenRevision; }

  public synchronized boolean ownsTokenRequest(long revision, boolean mustBeStarted) {
    return commissioned() && revision == tokenRevision && (!mustBeStarted || tokenUpdatesStarted);
  }

  public synchronized boolean acceptsTokenRefresh() {
    return commissioned() && tokenUpdatesStarted;
  }

  public synchronized void stopTokenUpdates() {
    tokenUpdatesStarted = false; ++tokenRevision;
  }

  public Phone11PendingWakeStore.Snapshot snapshot() { return store.snapshot(); }

  private boolean commissioned() {
    return status == Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS;
  }

  private static Phone11PendingWakeStore.Wake wake(Bundle data) {
    if (data == null) return null;
    return new Phone11PendingWakeStore.Wake(data.getInt("v", -1), data.getString("callUUID"),
        data.getString("bindingId"), data.getLong("expiresAt", -1));
  }

  private static Status readStatus(Context context) {
    try {
      ApplicationInfo info = context.getPackageManager().getApplicationInfo(
          context.getPackageName(), PackageManager.GET_META_DATA);
      Bundle metadata = info.metaData;
      boolean commissioned = metadata != null && metadata.getBoolean(META_COMMISSIONED, false);
      if (!commissioned) return Status.UNSUPPORTED_UNCOMMISSIONED;
      String environment = metadata.getString(META_ENVIRONMENT, "");
      if (!COMMISSIONED_STAGING_PACKAGE.equals(context.getPackageName()) || !"staging".equals(environment)) {
        return Status.UNSUPPORTED_MISCONFIGURED;
      }
      try {
        FirebaseOptions options = FirebaseApp.getInstance().getOptions();
        if (empty(options.getApplicationId()) || empty(options.getGcmSenderId())
            || empty(options.getProjectId())) return Status.UNSUPPORTED_MISCONFIGURED;
      } catch (IllegalStateException unavailable) {
        return Status.UNSUPPORTED_MISCONFIGURED;
      }
      return Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS;
    } catch (PackageManager.NameNotFoundException error) {
      return Status.UNSUPPORTED_MISCONFIGURED;
    }
  }

  private static boolean empty(String value) { return value == null || value.trim().isEmpty(); }
}
