package ai.phone11.siprix;

import java.util.*;

public final class PlaybackAudioOutputContract {
 private static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args){
  List<Phone11PlaybackAudioOutput.Candidate> candidates=Arrays.asList(
   new Phone11PlaybackAudioOutput.Candidate(91,Phone11PlaybackAudioOutput.Kind.BLUETOOTH),
   new Phone11PlaybackAudioOutput.Candidate(4,Phone11PlaybackAudioOutput.Kind.SPEAKER),
   new Phone11PlaybackAudioOutput.Candidate(2,Phone11PlaybackAudioOutput.Kind.PHONE),
   new Phone11PlaybackAudioOutput.Candidate(8,Phone11PlaybackAudioOutput.Kind.PHONE),
   new Phone11PlaybackAudioOutput.Candidate(91,Phone11PlaybackAudioOutput.Kind.BLUETOOTH),
   new Phone11PlaybackAudioOutput.Candidate(93,Phone11PlaybackAudioOutput.Kind.BLUETOOTH));
  List<Phone11PlaybackAudioOutput.Output> values=Phone11PlaybackAudioOutput.list(candidates,91);
  require(values.size()==4,"deduplicates native IDs");
  require(values.get(0).id.equals("android:2")&&values.get(0).label.equals("Phone"),"phone first");
  require(values.get(1).id.equals("android:4")&&values.get(1).label.equals("Speaker"),"speaker second");
  require(values.get(2).label.equals("Bluetooth audio")&&values.get(2).selected,"selected Bluetooth is generic");
  require(values.get(3).label.equals("Bluetooth audio 2")&&!values.get(3).selected,"multiple Bluetooth routes stay distinct");
  require(Phone11PlaybackAudioOutput.parseDeviceId("android:2147483647")==Integer.MAX_VALUE,"accepts bounded native ID");
  for(String invalid:Arrays.asList("2","android:-1","android:02","android:2147483648","android:2/private-name","bluetooth:2")){
   try{Phone11PlaybackAudioOutput.parseDeviceId(invalid);throw new AssertionError("accepted "+invalid);}catch(IllegalArgumentException expected){}
  }
 }
}
