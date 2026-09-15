package ai.phone11.siprix;

import android.content.Intent;

import com.google.firebase.messaging.RemoteMessage;

import expo.modules.notifications.service.ExpoFirebaseMessagingService;

/**
 * Default-disabled FCM ingress for the isolated Android staging package.
 * It accepts only a fresh data-only wake owned by the persisted login binding.
 */
public final class Phone11FirebaseMessagingService extends ExpoFirebaseMessagingService {
  private void recordIngress(long receivedAt, boolean envelopeShapeValid,
      Phone11FirebaseDiagnostic.ReceiptReason reason) {
    try {
      new Phone11FirebaseDiagnosticStore(this).recordIngress(receivedAt, envelopeShapeValid, reason);
      Phone11SiprixModule.publishFirebaseDiagnosticChanged();
    } catch (RuntimeException ignored) {}
  }

  @Override public void onMessageReceived(RemoteMessage message) {
    if (message == null) return;
    if (!Phone11FcmWakeEnvelope.isPhone11(message.getData())) {
      super.onMessageReceived(message);
      return;
    }
    Phone11AndroidWakeRuntime runtime = Phone11AndroidWakeRuntime.get(this);
    if (runtime.status() != Phone11AndroidWakeRuntime.Status.COMMISSIONED_WAITING_FOR_PROVIDER_INGRESS) return;
    long receivedAt = System.currentTimeMillis();
    if (message.getNotification() != null) {
      recordIngress(receivedAt, false, Phone11FirebaseDiagnostic.ReceiptReason.NOT_DATA_ONLY);
      return;
    }
    Phone11PendingWakeStore.Wake wake = Phone11FcmWakeEnvelope.parse(message.getData());
    if (wake == null) {
      recordIngress(receivedAt, false, Phone11FirebaseDiagnostic.ReceiptReason.INVALID_ENVELOPE);
      return;
    }

    Phone11PendingWakeStore.Decision decision = runtime.receive(wake, receivedAt);
    recordIngress(receivedAt, true, Phone11FirebaseDiagnostic.ReceiptReason.from(decision));
    // Only the first accepted provider delivery reaches presentation ownership.
    // Replays, tombstones, old bindings, logout and corrupt state stop here.
    if (decision != Phone11PendingWakeStore.Decision.ACCEPTED) return;

    Intent intent = new Intent(this, Phone11IncomingCallService.class)
        .setAction(Phone11IncomingCallService.ACTION_WAKE)
        .putExtra("v", wake.version)
        .putExtra("callUUID", wake.callUUID)
        .putExtra("bindingId", wake.bindingId)
        .putExtra("expiresAt", wake.expiresAt);
    startService(intent);
  }

  /** Preserve the existing generic notification token lifecycle without logging it here. */
  @Override public void onNewToken(String token) {
    super.onNewToken(token);
    Phone11SiprixModule.publishFirebaseToken(token);
  }
}
