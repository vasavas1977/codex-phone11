package ai.phone11.siprix;
import expo.modules.notifications.service.ExpoFirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import android.content.Intent;
import android.os.Build;
import java.util.Map;

/** No caller/config/grant fields accepted through FCM. A wake is authenticated after notification. */
public final class Phone11FirebaseMessagingService extends ExpoFirebaseMessagingService {
  @Override public void onNewToken(String token){super.onNewToken(token);Phone11AndroidWakeCoordinator.tokenChanged();}
  @Override public void onMessageReceived(RemoteMessage message){
    if(!message.getData().containsKey("callUUID")&&!message.getData().containsKey("bindingId")){super.onMessageReceived(message);return;}
    if(!BuildConfig.WAKE_CANDIDATE_ENABLED||message.getPriority()!=RemoteMessage.PRIORITY_HIGH||message.getNotification()!=null)return;
    Map<String,String> data=message.getData();if(data.size()!=4||!"1".equals(data.get("v"))||!data.keySet().containsAll(java.util.Arrays.asList("v","callUUID","bindingId","expiresAt")))return;
    try{long expiry=Long.parseLong(data.get("expiresAt"));if(!Long.toString(expiry).equals(data.get("expiresAt")))return;
      Intent intent=new Intent(this,Phone11IncomingCallService.class).setAction(Phone11IncomingCallService.PUSH).putExtra("callUUID",data.get("callUUID")).putExtra("bindingId",data.get("bindingId")).putExtra("expiresAt",expiry);
      if(Build.VERSION.SDK_INT>=26)startForegroundService(intent);else startService(intent);
    }catch(RuntimeException failure){/* OS refusal never becomes a reported successful wake. */}
  }
}
