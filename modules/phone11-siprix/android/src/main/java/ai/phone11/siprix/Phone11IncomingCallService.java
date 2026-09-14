package ai.phone11.siprix;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * The sole Android owner for a future authenticated incoming-call notification.
 * It has no exported intent filter and does not initialize SIP, audio, or Firebase.
 */
public final class Phone11IncomingCallService extends Service {
  public static final String ACTION_WAKE = "ai.phone11.siprix.action.WAKE";
  public static final String ACTION_CANCEL = "ai.phone11.siprix.action.CANCEL";
  public static final String ACTION_LOGOUT = "ai.phone11.siprix.action.LOGOUT";
  private static final String CHANNEL = "phone11_incoming_calls";
  private static final int NOTIFICATION_ID = 110011;

  @Override public IBinder onBind(Intent intent) { return null; }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    Phone11AndroidWakeRuntime runtime = Phone11AndroidWakeRuntime.get(this);
    NotificationManager notifications = getSystemService(NotificationManager.class);
    if (runtime.status() != Phone11AndroidWakeRuntime.Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS) {
      notifications.cancel(NOTIFICATION_ID);
      stopSelf(startId);
      return START_NOT_STICKY;
    }
    String action = intent == null ? null : intent.getAction();
    if (ACTION_LOGOUT.equals(action)) {
      runtime.logout();
      notifications.cancel(NOTIFICATION_ID);
    } else if (ACTION_CANCEL.equals(action)) {
      runtime.cancel(intent.getExtras(), System.currentTimeMillis());
      notifications.cancel(NOTIFICATION_ID);
    } else if (ACTION_WAKE.equals(action)) {
      Phone11PendingWakeStore.Decision decision = runtime.receive(
          intent.getExtras(), System.currentTimeMillis());
      if (decision == Phone11PendingWakeStore.Decision.ACCEPTED
          || decision == Phone11PendingWakeStore.Decision.DUPLICATE) {
        notifications.notify(NOTIFICATION_ID, incomingNotification(notifications));
      }
    }
    stopSelf(startId);
    return START_NOT_STICKY;
  }

  private Notification incomingNotification(NotificationManager notifications) {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(
          CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("Incoming Phone11 calls");
      notifications.createNotificationChannel(channel);
    }
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent content = launch == null ? null : PendingIntent.getActivity(this, 0, launch,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder = Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
    return builder.setSmallIcon(getApplicationInfo().icon)
        .setContentTitle("Incoming Phone11 call")
        .setContentText("Open Phone11 to continue")
        .setCategory(Notification.CATEGORY_CALL)
        .setOngoing(true)
        .setAutoCancel(false)
        .setContentIntent(content)
        .build();
  }
}
