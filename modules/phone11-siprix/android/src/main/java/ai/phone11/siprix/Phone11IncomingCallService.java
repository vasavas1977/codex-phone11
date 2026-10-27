package ai.phone11.siprix;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.media.AudioAttributes;
import android.provider.Settings;

/** Nonexported notification actions are immutable and match the active native epoch. */
@SuppressWarnings("deprecation")
public final class Phone11IncomingCallService extends Service {
  static final String LOCAL="ai.phone11.LOCAL_CALL",PUSH="ai.phone11.WAKE_PUSH",ANSWER="ai.phone11.WAKE_ANSWER",END="ai.phone11.WAKE_END";
  private static final String RING="phone11-native-incoming-v1",CALL="phone11-native-active-v1";private static final int NOTICE=11011;
  private String uuid,binding;private long epoch;private boolean mic,foregroundStarted;
  @Override public IBinder onBind(Intent intent){return null;}
  @Override public void onCreate(){super.onCreate();if(!BuildConfig.WAKE_CANDIDATE_ENABLED){stopSelf();return;}try{channels();if(Build.VERSION.SDK_INT>=29)startForeground(NOTICE,notice(false),ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);else startForeground(NOTICE,notice(false));foregroundStarted=true;}catch(RuntimeException failure){stopSelf();}}
  @Override public int onStartCommand(Intent intent,int flags,int startId){
    String handoff=intent==null?null:intent.getStringExtra(Phone11WakeCpuLock.EXTRA_HANDOFF);
    try{
      if(!BuildConfig.WAKE_CANDIDATE_ENABLED||!foregroundStarted||intent==null){stopSelf();return START_NOT_STICKY;}
      Phone11AndroidWakeCoordinator owner=Phone11AndroidWakeCoordinator.get(this);String action=intent.getAction();
      if(LOCAL.equals(action))owner.localService(this);
      else if(PUSH.equals(action))owner.receive(this,intent.getStringExtra("callUUID"),intent.getStringExtra("bindingId"),intent.getLongExtra("expiresAt",0),handoff);
      else if(ANSWER.equals(action))owner.answer(intent.getStringExtra("callUUID"),intent.getStringExtra("bindingId"),intent.getLongExtra("epoch",0));
      else if(END.equals(action))owner.end(intent.getStringExtra("callUUID"),intent.getStringExtra("bindingId"),intent.getLongExtra("epoch",0));
      return START_NOT_STICKY;
    }finally{Phone11WakeCpuLock.get(this).releaseHandoff(handoff);}
  }
  private void channels(){if(Build.VERSION.SDK_INT<26)return;NotificationManager manager=getSystemService(NotificationManager.class);NotificationChannel ring=new NotificationChannel(RING,"Incoming Phone11 calls",NotificationManager.IMPORTANCE_HIGH);ring.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);ring.setSound(Settings.System.DEFAULT_RINGTONE_URI,new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());manager.createNotificationChannel(ring);NotificationChannel active=new NotificationChannel(CALL,"Phone11 active calls",NotificationManager.IMPORTANCE_LOW);active.setSound(null,null);manager.createNotificationChannel(active);}
  private PendingIntent action(String action,int code){Intent intent=new Intent(this,Phone11IncomingCallService.class).setAction(action).putExtra("callUUID",uuid).putExtra("bindingId",binding).putExtra("epoch",epoch);return PendingIntent.getService(this,code,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
  private Notification notice(boolean active){Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,active?CALL:RING):new Notification.Builder(this);builder.setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle("Phone11").setContentText(active?"Phone11 call in progress":"Incoming Phone11 call").setCategory(Notification.CATEGORY_CALL).setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(true).setOnlyAlertOnce(true);Intent launch=getPackageManager().getLaunchIntentForPackage(getPackageName());if(launch!=null)builder.setContentIntent(PendingIntent.getActivity(this,11014,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));if(uuid!=null){PendingIntent end=action(END,11012);if(Build.VERSION.SDK_INT>=31){android.app.Person person=new android.app.Person.Builder().setName("Phone11").setImportant(true).build();builder.setStyle(active?Notification.CallStyle.forOngoingCall(person,end):Notification.CallStyle.forIncomingCall(person,end,action(ANSWER,11013)));}else{builder.addAction(android.R.drawable.ic_menu_close_clear_cancel,"End",end);if(!active)builder.addAction(android.R.drawable.sym_call_incoming,"Answer",action(ANSWER,11013));}}return builder.build();}
  void show(String uuid,String binding,long epoch,boolean active){this.uuid=uuid;this.binding=binding;this.epoch=epoch;getSystemService(NotificationManager.class).notify(NOTICE,notice(active));}
  // Called only in response to the user's system/notification Answer action.
  boolean microphone(){try{if(Build.VERSION.SDK_INT>=30)startForeground(NOTICE,notice(false),ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL|ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);mic=true;return true;}catch(RuntimeException failure){return false;}}
  void done(){foregroundStarted=false;if(Build.VERSION.SDK_INT>=24)stopForeground(STOP_FOREGROUND_REMOVE);else stopForeground(true);stopSelf();}
  @Override public void onDestroy(){foregroundStarted=false;Phone11AndroidWakeCoordinator.get(this).serviceDestroyed(this);mic=false;super.onDestroy();}
}
