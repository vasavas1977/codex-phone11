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
  private static final String LAB_PACKAGE = "ai.phone11.mobile.lab";
  private static Phone11AndroidWakeRuntime instance;

  public enum Status {
    UNSUPPORTED_UNCOMMISSIONED,
    UNSUPPORTED_MISCONFIGURED,
    COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS
  }

  private final Status status;
  private final Phone11PendingWakeStore store;

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
    if (status != Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS) store.logout();
  }

  public Status status() { return status; }

  public Phone11PendingWakeStore.Decision bind(Phone11PendingWakeStore.Binding binding, long now) {
    if (!commissioned()) return Phone11PendingWakeStore.Decision.REJECTED_LOGGED_OUT;
    return store.bind(binding, now);
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

  public void logout() { store.logout(); }

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
      if (!LAB_PACKAGE.equals(context.getPackageName()) || !"staging".equals(environment)) {
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
