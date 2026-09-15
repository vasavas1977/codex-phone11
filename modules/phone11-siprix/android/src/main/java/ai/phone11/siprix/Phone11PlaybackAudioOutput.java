package ai.phone11.siprix;

import java.util.*;

/** Pure contract for the bounded audio-output values exposed to React Native. */
final class Phone11PlaybackAudioOutput {
 enum Kind { PHONE, SPEAKER, BLUETOOTH }

 static final class Candidate {
  final int deviceId;
  final Kind kind;
  Candidate(int deviceId,Kind kind){this.deviceId=deviceId;this.kind=kind;}
 }

 static final class Output {
  final int deviceId;
  final String id,kind,label;
  final boolean selected;
  Output(int deviceId,Kind kind,String label,boolean selected){
   this.deviceId=deviceId;this.id="android:"+deviceId;this.kind=kind.name().toLowerCase(Locale.ROOT);
   this.label=label;this.selected=selected;
  }
  Map<String,Object> publicValue(){
   Map<String,Object> value=new LinkedHashMap<>();
   value.put("id",id);value.put("kind",kind);value.put("label",label);value.put("selected",selected);
   return value;
  }
 }

 private static final int MAX_OUTPUTS=10;

 static List<Output> list(Collection<Candidate> values,Integer selectedDeviceId){
  Map<Integer,Candidate> unique=new LinkedHashMap<>();
  for(Candidate value:values)if(value!=null&&value.kind!=null&&value.deviceId>=0)unique.putIfAbsent(value.deviceId,value);
  List<Candidate> ordered=new ArrayList<>(unique.values());
  ordered.sort(Comparator.comparingInt((Candidate value)->rank(value.kind))
   .thenComparingInt(value->selectedDeviceId!=null&&selectedDeviceId==value.deviceId?0:1)
   .thenComparingInt(value->value.deviceId));
  List<Output> result=new ArrayList<>();Set<Kind> fixedKinds=new HashSet<>();int bluetoothIndex=0;
  for(Candidate value:ordered){
   if(result.size()>=MAX_OUTPUTS)break;
   String label;
   if(value.kind==Kind.PHONE){if(!fixedKinds.add(value.kind))continue;label="Phone";}
   else if(value.kind==Kind.SPEAKER){if(!fixedKinds.add(value.kind))continue;label="Speaker";}
   else {bluetoothIndex++;label=bluetoothIndex==1?"Bluetooth audio":"Bluetooth audio "+bluetoothIndex;}
   result.add(new Output(value.deviceId,value.kind,label,selectedDeviceId!=null&&selectedDeviceId==value.deviceId));
  }
  return result;
 }

 static int parseDeviceId(String value){
  if(value==null||!value.matches("android:(0|[1-9][0-9]{0,9})"))throw new IllegalArgumentException();
  long parsed=Long.parseLong(value.substring("android:".length()));
  if(parsed>Integer.MAX_VALUE)throw new IllegalArgumentException();
  return (int)parsed;
 }

 private static int rank(Kind kind){return kind==Kind.PHONE?0:kind==Kind.SPEAKER?1:2;}
}
