package ai.phone11.siprix;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import java.util.*;

/** Android communication-device adapter. It never exports platform device names. */
final class Phone11PlaybackAudioRouter {
 private final AudioManager audio;
 private final Runnable changed;
 private final AudioDeviceCallback deviceCallback;

 Phone11PlaybackAudioRouter(Context context,Runnable changed){
  audio=(AudioManager)context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
  if(audio==null)throw new IllegalStateException();
  this.changed=changed;
  deviceCallback=new AudioDeviceCallback(){
   @Override public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices){changed.run();}
   @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices){changed.run();}
  };
  audio.registerAudioDeviceCallback(deviceCallback,null);
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S)
   audio.addOnCommunicationDeviceChangedListener(context.getMainExecutor(),device->changed.run());
 }

 Map<String,Object> snapshot(){
  List<Device> devices=devices();Integer selected=selectedDeviceId(devices);
  List<Map<String,Object>> outputs=new ArrayList<>();
  for(Phone11PlaybackAudioOutput.Output output:Phone11PlaybackAudioOutput.list(candidates(devices),selected))outputs.add(output.publicValue());
  Map<String,Object> value=new LinkedHashMap<>();value.put("outputs",outputs);
  value.put("selectedId",selected==null?null:"android:"+selected);
  return value;
 }

 Map<String,Object> select(String publicId){
  int requested=Phone11PlaybackAudioOutput.parseDeviceId(publicId);
  List<Device> available=devices();Device selected=null;
  for(Device device:available)if(device.info.getId()==requested&&device.kind!=null){selected=device;break;}
  if(selected==null)throw new IllegalArgumentException();
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S){
   if(!audio.setCommunicationDevice(selected.info))throw new IllegalStateException();
   AudioDeviceInfo effective=audio.getCommunicationDevice();
   if(effective==null||effective.getId()!=requested)throw new IllegalStateException();
  }else if(selected.kind==Phone11PlaybackAudioOutput.Kind.SPEAKER){
   audio.setSpeakerphoneOn(true);
  }else if(selected.kind==Phone11PlaybackAudioOutput.Kind.PHONE){
   audio.setSpeakerphoneOn(false);
  }else throw new UnsupportedOperationException("exact Bluetooth selection requires Android 12");
  return snapshot();
 }

 void releaseSelection(){
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S)audio.clearCommunicationDevice();
  else audio.setSpeakerphoneOn(false);
 }

 private List<Device> devices(){
  Collection<AudioDeviceInfo> values;
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S)values=audio.getAvailableCommunicationDevices();
  else values=Arrays.asList(audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS));
  List<Device> result=new ArrayList<>();
  for(AudioDeviceInfo value:values){
   Phone11PlaybackAudioOutput.Kind kind=kind(value.getType());
   // Android 11 and earlier cannot bind one concrete Bluetooth output.
   if(kind!=null&&(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S||kind!=Phone11PlaybackAudioOutput.Kind.BLUETOOTH))result.add(new Device(value,kind));
  }
  return result;
 }

 private Integer selectedDeviceId(List<Device> available){
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S){
   AudioDeviceInfo selected=audio.getCommunicationDevice();if(selected==null)return null;
   for(Device value:available)if(value.info.getId()==selected.getId())return selected.getId();
   return null;
  }
  Phone11PlaybackAudioOutput.Kind expected=audio.isSpeakerphoneOn()?Phone11PlaybackAudioOutput.Kind.SPEAKER:Phone11PlaybackAudioOutput.Kind.PHONE;
  for(Device value:available)if(value.kind==expected)return value.info.getId();
  return null;
 }

 private static Collection<Phone11PlaybackAudioOutput.Candidate> candidates(List<Device> values){
  List<Phone11PlaybackAudioOutput.Candidate> result=new ArrayList<>();
  for(Device value:values)result.add(new Phone11PlaybackAudioOutput.Candidate(value.info.getId(),value.kind));
  return result;
 }

 private static Phone11PlaybackAudioOutput.Kind kind(int type){
  if(type==AudioDeviceInfo.TYPE_BUILTIN_EARPIECE||type==AudioDeviceInfo.TYPE_TELEPHONY)return Phone11PlaybackAudioOutput.Kind.PHONE;
  if(type==AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)return Phone11PlaybackAudioOutput.Kind.SPEAKER;
  if(type==AudioDeviceInfo.TYPE_BLUETOOTH_SCO||type==AudioDeviceInfo.TYPE_HEARING_AID||
    (Build.VERSION.SDK_INT>=Build.VERSION_CODES.S&&(type==AudioDeviceInfo.TYPE_BLE_HEADSET||type==AudioDeviceInfo.TYPE_BLE_SPEAKER)))
   return Phone11PlaybackAudioOutput.Kind.BLUETOOTH;
  return null;
 }

 private static final class Device {
  final AudioDeviceInfo info;final Phone11PlaybackAudioOutput.Kind kind;
  Device(AudioDeviceInfo info,Phone11PlaybackAudioOutput.Kind kind){this.info=info;this.kind=kind;}
 }
}
