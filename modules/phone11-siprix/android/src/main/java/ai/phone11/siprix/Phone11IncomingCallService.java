package ai.phone11.siprix;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.Service;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
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
  static final String ACTION_OPEN = "ai.phone11.siprix.action.OPEN";
  static final String ACTION_ANSWER = "ai.phone11.siprix.action.ANSWER";
  static final String ACTION_DECLINE = "ai.phone11.siprix.action.DECLINE";
  static final String EXTRA_CALL_UUID = "phone11CallUUID";
  static final String EXTRA_BINDING_ID = "phone11BindingId";
  static final String EXTRA_NOTICE_ACTION = "phone11NoticeAction";
  private static final String CHANNEL = "phone11_incoming_calls";
  private static final int NOTIFICATION_ID = 110011;

  @Override public IBinder onBind(Intent intent) { return null; }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    Phone11AndroidWakeRuntime runtime = Phone11AndroidWakeRuntime.get(this);
    NotificationManager notifications = getSystemService(NotificationManager.class);
    if (runtime.status() != Phone11AndroidWakeRuntime.Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS) {
      cancel(notifications);
      stopSelf(startId);
      return START_NOT_STICKY;
    }
    String action = intent == null ? null : intent.getAction();
    if (ACTION_LOGOUT.equals(action)) {
      runtime.logout();
      cancel(notifications);
    } else if (ACTION_CANCEL.equals(action)) {
      Phone11PendingWakeStore.Decision decision = runtime.cancel(
          intent.getExtras(), System.currentTimeMillis());
      if (Phone11IncomingCallNoticeOwner.clearsNotice(decision)) cancel(notifications);
    } else if (ACTION_WAKE.equals(action)) {
      Phone11PendingWakeStore.Decision decision = runtime.receive(
          intent.getExtras(), System.currentTimeMillis());
      if (decision == Phone11PendingWakeStore.Decision.ACCEPTED
          || decision == Phone11PendingWakeStore.Decision.DUPLICATE) {
        Phone11PendingWakeStore.Snapshot snapshot = runtime.snapshot();
        if (Phone11IncomingCallNoticeOwner.ownsPending(
            snapshot, snapshot.callUUID, snapshot.bindingId) && notifications != null) {
          notifySafely(notifications, incomingNotification(notifications, snapshot));
        }
      }
    } else if (ACTION_ANSWER.equals(action)) {
      if (owns(runtime, intent)) {
        String callUUID = intent.getStringExtra(EXTRA_CALL_UUID);
        Phone11PendingWakeStore.Decision decision = runtime.complete(
            callUUID, System.currentTimeMillis());
        if (Phone11IncomingCallNoticeOwner.clearsNotice(decision)) {
          cancel(notifications);
        }
      }
    } else if (ACTION_DECLINE.equals(action)) {
      if (owns(runtime, intent)) {
        Phone11PendingWakeStore.Decision decision = runtime.complete(
            intent.getStringExtra(EXTRA_CALL_UUID), System.currentTimeMillis());
        if (Phone11IncomingCallNoticeOwner.clearsNotice(decision)) cancel(notifications);
      }
    }
    stopSelf(startId);
    return START_NOT_STICKY;
  }

  private Notification incomingNotification(NotificationManager notifications,
      Phone11PendingWakeStore.Snapshot snapshot) {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(
          CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("Incoming Phone11 calls");
      channel.enableVibration(true);
      channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
      notifications.createNotificationChannel(channel);
    }
    PendingIntent open = activityAction(snapshot, "open",
        Phone11IncomingCallNoticeOwner.OPEN);
    PendingIntent answer = serviceAction(ACTION_ANSWER, snapshot,
        Phone11IncomingCallNoticeOwner.ANSWER);
    PendingIntent decline = serviceAction(ACTION_DECLINE, snapshot,
        Phone11IncomingCallNoticeOwner.DECLINE);
    Notification.Builder builder = Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
    int icon = getApplicationInfo().icon == 0
        ? android.R.drawable.sym_call_incoming : getApplicationInfo().icon;
    builder.setSmallIcon(icon)
        .setContentTitle("Incoming Phone11 call")
        .setContentText("Open Phone11 to continue")
        .setCategory(Notification.CATEGORY_CALL)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setPriority(Notification.PRIORITY_MAX)
        .setOngoing(true)
        .setAutoCancel(false)
        .setContentIntent(open);
    if (Build.VERSION.SDK_INT >= 26) {
      builder.setTimeoutAfter(Math.max(1L, snapshot.callExpiresAt - System.currentTimeMillis()));
    }
    if (Build.VERSION.SDK_INT >= 31) {
      Person caller = new Person.Builder().setName("Phone11 caller").setImportant(true).build();
      builder.setStyle(Notification.CallStyle.forIncomingCall(caller, decline, answer));
    } else {
      builder.addAction(new Notification.Action.Builder(0, "Decline", decline).build());
      builder.addAction(new Notification.Action.Builder(0, "Answer", answer).build());
    }
    if (canUseFullScreenIntent() && open != null) {
      PendingIntent fullScreen = activityAction(snapshot, "open",
          Phone11IncomingCallNoticeOwner.FULL_SCREEN);
      if (fullScreen != null) builder.setFullScreenIntent(fullScreen, true);
    }
    return builder.build();
  }

  private PendingIntent serviceAction(String action, Phone11PendingWakeStore.Snapshot snapshot,
      int actionCode) {
    Intent intent = new Intent(this, Phone11IncomingCallService.class)
        .setAction(action)
        .putExtra(EXTRA_CALL_UUID, snapshot.callUUID)
        .putExtra(EXTRA_BINDING_ID, snapshot.bindingId);
    return PendingIntent.getService(this,
        Phone11IncomingCallNoticeOwner.requestCode(snapshot.callUUID, actionCode), intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private PendingIntent activityAction(Phone11PendingWakeStore.Snapshot snapshot, String action,
      int actionCode) {
    Intent launch = launchIntent(snapshot.callUUID, snapshot.bindingId, action);
    return launch == null ? null : PendingIntent.getActivity(this,
        Phone11IncomingCallNoticeOwner.requestCode(snapshot.callUUID, actionCode), launch,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private Intent launchIntent(String callUUID, String bindingId, String action) {
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch == null) return null;
    return launch.setAction(ACTION_OPEN)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(EXTRA_CALL_UUID, callUUID)
        .putExtra(EXTRA_BINDING_ID, bindingId)
        .putExtra(EXTRA_NOTICE_ACTION, action);
  }

  private static boolean owns(Phone11AndroidWakeRuntime runtime, Intent intent) {
    return intent != null && Phone11IncomingCallNoticeOwner.ownsPending(runtime.snapshot(),
        intent.getStringExtra(EXTRA_CALL_UUID), intent.getStringExtra(EXTRA_BINDING_ID));
  }

  private boolean canUseFullScreenIntent() {
    if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(
        Manifest.permission.USE_FULL_SCREEN_INTENT) != PackageManager.PERMISSION_GRANTED) {
      return false;
    }
    NotificationManager notifications = getSystemService(NotificationManager.class);
    return Build.VERSION.SDK_INT < 34 || (notifications != null
        && notifications.canUseFullScreenIntent());
  }

  private void notifySafely(NotificationManager notifications, Notification notification) {
    if (notifications == null) return;
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(
        Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
    try {
      notifications.notify(NOTIFICATION_ID, notification);
    } catch (SecurityException denied) {
      // The persisted pending owner remains available for an in-app recovery path.
    }
  }

  private static void cancel(NotificationManager notifications) {
    if (notifications != null) notifications.cancel(NOTIFICATION_ID);
  }
}
