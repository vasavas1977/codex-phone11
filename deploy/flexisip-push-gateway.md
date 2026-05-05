# Flexisip Push Gateway Configuration

This document describes the Flexisip push gateway setup for CloudPhone11 push notifications via FCM (Android) and APNs (iOS).

## Architecture Overview

The Flexisip push gateway sits between the SIP proxy (Kamailio) and the mobile push services (FCM/APNs). When a SIP INVITE or MESSAGE arrives for a user whose device is offline or in background, Kamailio triggers Flexisip to send a push notification that wakes the device.

```
SIP INVITE → Kamailio → Flexisip Push Gateway → FCM (Android) / APNs (iOS) → Device
```

## Flexisip Configuration

### `/etc/flexisip/flexisip.conf`

```ini
[global]
debug=false
log-level=warning

[module::PushNotification]
enabled=true

# Firebase Cloud Messaging (Android)
firebase-projects-api-key=YOUR_FCM_SERVER_KEY
firebase-service-accounts=/etc/flexisip/firebase-service-account.json

# Apple Push Notification Service (iOS)
apple-push-type=pushkit
apple-certificate=/etc/flexisip/apns-cert.pem
apple-certificate-key=/etc/flexisip/apns-key.pem
apple-push-sandbox=false

# Push notification content
call-push-title=CloudPhone11
call-push-body=Incoming call from %caller%
message-push-title=CloudPhone11
message-push-body=New message from %sender%

# Token registration
register-on-gateway=true
gateway-uri=sip:push.yourserver.com;transport=tcp

# Retry configuration
max-push-retries=3
push-retry-interval=5
```

## Android Notification Channels

CloudPhone11 registers the following Android notification channels:

| Channel ID | Name | Importance | Use Case |
|------------|------|------------|----------|
| `missed_calls` | Missed Calls | HIGH | Missed call alerts |
| `voicemail` | Voicemail | HIGH | New voicemail alerts |
| `recordings` | Recordings | DEFAULT | Recording ready alerts |
| `sip_status` | SIP Status | LOW | Registration changes |
| `system` | System | DEFAULT | App updates, system messages |

## FCM Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Add Android app with package name matching `app.config.ts`
3. Download `google-services.json` and place in project root
4. Generate a server key and add to Flexisip config

## APNs Setup

1. Create an APNs certificate in Apple Developer portal
2. Export as `.pem` files (cert + key)
3. Place in `/etc/flexisip/` on the Flexisip server
4. Set `apple-push-sandbox=true` for development, `false` for production

## Kamailio Integration

Add to Kamailio config to trigger push on missed calls:

```cfg
# When call is not answered after 30 seconds
failure_route[PUSH_MISSED] {
    if (t_check_status("408|480|487")) {
        # Trigger Flexisip push for missed call
        $var(push_body) = '{"type":"missed_call","caller":"' + $fU + '","callee":"' + $rU + '"}';
        http_client_query("http://localhost:8080/api/v1/push/missed-call",
            "$var(push_body)", "$var(push_result)");
    }
}
```

## Voicemail Push Integration

When FreeSWITCH deposits a voicemail, trigger a push notification:

```xml
<!-- FreeSWITCH voicemail.xml -->
<action application="set" data="voicemail_notify_push=true"/>
<action application="curl" data="http://push-gateway:8080/api/v1/push/voicemail
    post caller=${caller_id_number}&callee=${dialed_extension}&duration=${voicemail_duration}"/>
```

## Testing

Use the CloudPhone11 Notification Preferences screen to verify:
- Push token registration status
- Per-category notification toggles
- Sound and vibration settings
- Quiet hours configuration

Send a test push via the admin portal or curl:

```bash
curl -X POST http://push-gateway:8080/api/v1/push/test \
  -H "Content-Type: application/json" \
  -d '{"sip_uri": "sip:user@yourserver.com", "title": "Test", "body": "Push test"}'
```
