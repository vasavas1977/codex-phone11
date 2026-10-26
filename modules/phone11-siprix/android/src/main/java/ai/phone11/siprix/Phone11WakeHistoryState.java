package ai.phone11.siprix;

import java.io.*;
import java.util.*;
import java.util.function.LongSupplier;
import java.util.regex.*;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Pure-Java completed-call spool. Storage supplies authenticated encryption and
 * atomic replacement. No grant, binding, SIP account or raw remote URI is saved.
 * At most 100 records and 256 acknowledgment tombstones survive for 30 days.
 * A completed UUID is immutable, including after acknowledgment within retention.
 * Failed reads never become an empty replacement; failed appends remain bounded
 * in memory for retry, and failed acknowledgments leave durable records intact. */
final class Phone11WakeHistoryState {
  interface Storage { byte[] read() throws Exception; void write(byte[] bytes) throws Exception; void reset() throws Exception; }
  static final class Failure extends RuntimeException {
    private static final long serialVersionUID=1L;
    final String code; Failure(String code){super(code);this.code=code;}
  }
  static final int LIMIT=100, ACK_LIMIT=256, MAX_BYTES=262144;
  private static final long RETENTION=30L*86400000L, MAX_SAFE=9007199254740991L;
  private static final int MAGIC=0x50313148, VERSION=1;
  private static final Set<String> FIELDS=new HashSet<>(Arrays.asList("id","ownerUserId","tenantId","number","direction","startedAt","answeredAt","endedAt","updatedAt"));
  private static final Pattern SIP=Pattern.compile("^sips?:([+0-9A-Za-z*#_.-]{1,64})@[^\\s<>]+$",Pattern.CASE_INSENSITIVE);
  private final Storage storage; private final LongSupplier clock;
  private boolean clearPending;
  private final LinkedHashMap<String,Map<String,Object>> pending=new LinkedHashMap<>();
  Phone11WakeHistoryState(Storage storage,LongSupplier clock){this.storage=Objects.requireNonNull(storage);this.clock=Objects.requireNonNull(clock);}
  private static Failure invalid(){return new Failure("E_INVALID_ARGUMENT");}
  private static long integer(Object value){if(!(value instanceof Number))throw invalid();double n=((Number)value).doubleValue();if(!Double.isFinite(n)||n<=0||n>MAX_SAFE||n!=Math.rint(n))throw invalid();return ((Number)value).longValue();}
  private static boolean uuid(String value){try{return value!=null&&UUID.fromString(value).toString().equals(value);}catch(IllegalArgumentException error){return false;}}
  private static boolean id(String value){return value!=null&&value.startsWith("native-wake:")&&uuid(value.substring(12));}
  private static String text(Object value){if(!(value instanceof String))throw invalid();return (String)value;}
  private static Map<String,Object> validate(Map<String,Object> row){
    if(row==null||!FIELDS.containsAll(row.keySet())||row.size()<8||row.size()>9||!id(text(row.get("id")))||!"inbound".equals(row.get("direction")))throw invalid();
    String number=text(row.get("number"));if(!number.matches("[+0-9A-Za-z*#_.-]{1,64}"))throw invalid();
    Map<String,Object> clean=new LinkedHashMap<>();clean.put("id",row.get("id"));clean.put("ownerUserId",integer(row.get("ownerUserId")));clean.put("tenantId",integer(row.get("tenantId")));clean.put("number",number);clean.put("direction","inbound");
    long start=integer(row.get("startedAt")),end=integer(row.get("endedAt")),updated=integer(row.get("updatedAt"));if(end<start||updated<end)throw invalid();
    clean.put("startedAt",start);if(row.containsKey("answeredAt")){long answer=integer(row.get("answeredAt"));if(answer<start||answer>end)throw invalid();clean.put("answeredAt",answer);}clean.put("endedAt",end);clean.put("updatedAt",updated);return clean;
  }
  private static Map<String,Object> scope(Map<String,Object> binding){
    try{if(binding==null||binding.size()!=6||!uuid(text(binding.get("bindingId")))||!uuid(text(binding.get("sessionBinding"))))throw invalid();
      String device=text(binding.get("deviceId"));if(device.isEmpty()||device.length()>512||device.chars().anyMatch(c->c<=32||c==127))throw invalid();
      Map<String,Object> clean=new LinkedHashMap<>();clean.put("bindingId",binding.get("bindingId"));clean.put("sessionBinding",binding.get("sessionBinding"));clean.put("deviceId",device);clean.put("ownerUserId",integer(binding.get("ownerUserId")));clean.put("tenantId",integer(binding.get("tenantId")));clean.put("expiresAt",integer(binding.get("expiresAt")));return clean;
    }catch(RuntimeException error){throw new Failure("E_HISTORY_OWNER");}
  }
  private Map<String,Object> authorize(Map<String,Object> requested,Map<String,Object> current){Map<String,Object> a=scope(requested),b=scope(current);if(!a.equals(b)||(Long)b.get("expiresAt")<=clock.getAsLong())throw new Failure("E_HISTORY_OWNER");return a;}
  private static boolean own(Map<String,Object> row,Map<String,Object> binding){return row.get("ownerUserId").equals(binding.get("ownerUserId"))&&row.get("tenantId").equals(binding.get("tenantId"));}
  static String number(Object raw){if(!(raw instanceof String)||((String)raw).length()>2048)return "Unknown";String uri=(String)raw;Matcher match=SIP.matcher(uri);return match.matches()?match.group(1):uri.matches("[+0-9*#]{1,64}")?uri:"Unknown";}
  synchronized void record(Map<String,Object> captured,String callUUID,Map<String,Object> call){
    Map<String,Object> owner=scope(captured);if(!uuid(callUUID)||call==null||!"incoming".equals(call.get("direction"))||!"terminated".equals(call.get("state")))throw invalid();
    long start=integer(call.get("startedAt")),end=Math.max(start,clock.getAsLong());Map<String,Object> row=new LinkedHashMap<>();
    row.put("id","native-wake:"+callUUID);row.put("ownerUserId",owner.get("ownerUserId"));row.put("tenantId",owner.get("tenantId"));row.put("number",number(call.get("remoteUri")));row.put("direction","inbound");row.put("startedAt",start);
    if(call.containsKey("answeredAt")){long answered=integer(call.get("answeredAt"));if(answered<start)throw invalid();row.put("answeredAt",answered);end=Math.max(end,answered);}row.put("endedAt",end);row.put("updatedAt",end);row=validate(row);
    pending.putIfAbsent((String)row.get("id"),row);trimPending();
    Snapshot saved=load();merge(saved);save(saved);pending.clear();
  }
  synchronized List<Map<String,Object>> read(Map<String,Object> requested,Map<String,Object> current){Map<String,Object> owner=authorize(requested,current);Snapshot saved=load();merge(saved);List<Map<String,Object>> result=new ArrayList<>();for(Map<String,Object> row:saved.rows.values())if(own(row,owner))result.add(new LinkedHashMap<>(row));save(saved);pending.clear();return result;}
  synchronized void ack(Map<String,Object> requested,Map<String,Object> current,List<String> ids){
    Map<String,Object> owner=authorize(requested,current);if(ids==null||ids.size()>LIMIT)throw invalid();Set<String> unique=new HashSet<>();for(Object value:ids){if(!(value instanceof String)||!id((String)value))throw invalid();unique.add((String)value);}
    Snapshot saved=load();merge(saved);Iterator<Map.Entry<String,Map<String,Object>>> rows=saved.rows.entrySet().iterator();while(rows.hasNext()){Map.Entry<String,Map<String,Object>> row=rows.next();if(unique.contains(row.getKey())&&own(row.getValue(),owner)){saved.acknowledged.put(row.getKey(),clock.getAsLong());rows.remove();}}
    save(saved);pending.clear();
  }
  synchronized void clear(){pending.clear();clearPending=true;reset();}
  private void reset(){try{storage.reset();clearPending=false;}catch(Exception error){throw new Failure("E_HISTORY_STORAGE");}}
  private static final class Snapshot {final LinkedHashMap<String,Map<String,Object>> rows=new LinkedHashMap<>();final LinkedHashMap<String,Long> acknowledged=new LinkedHashMap<>();}
  private Snapshot load(){if(clearPending)reset();try{byte[] data=storage.read();if(data==null)return new Snapshot();try{return decode(data);}finally{Arrays.fill(data,(byte)0);}}catch(Exception error){throw new Failure("E_HISTORY_STORAGE");}}
  private void save(Snapshot saved){bound(saved);byte[] bytes=null;try{bytes=encode(saved);storage.write(bytes);}catch(Exception error){throw new Failure("E_HISTORY_STORAGE");}finally{if(bytes!=null)Arrays.fill(bytes,(byte)0);}}
  private void merge(Snapshot saved){for(Map.Entry<String,Map<String,Object>> row:pending.entrySet())if(!saved.acknowledged.containsKey(row.getKey()))saved.rows.putIfAbsent(row.getKey(),row.getValue());bound(saved);}
  private void trimPending(){List<Map<String,Object>> rows=new ArrayList<>(pending.values());rows.sort((a,b)->Long.compare((Long)b.get("endedAt"),(Long)a.get("endedAt")));pending.clear();for(Map<String,Object> row:rows)if(pending.size()<LIMIT)pending.put((String)row.get("id"),row);}
  private void bound(Snapshot saved){long cutoff=clock.getAsLong()-RETENTION;saved.rows.entrySet().removeIf(e->(Long)e.getValue().get("endedAt")<cutoff);List<Map<String,Object>> rows=new ArrayList<>(saved.rows.values());rows.sort((a,b)->{int order=Long.compare((Long)b.get("endedAt"),(Long)a.get("endedAt"));return order!=0?order:((String)a.get("id")).compareTo((String)b.get("id"));});saved.rows.clear();for(Map<String,Object> row:rows)if(saved.rows.size()<LIMIT)saved.rows.put((String)row.get("id"),row);saved.acknowledged.entrySet().removeIf(e->e.getValue()<cutoff);while(saved.acknowledged.size()>ACK_LIMIT)saved.acknowledged.remove(saved.acknowledged.keySet().iterator().next());}
  private static byte[] encode(Snapshot saved)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(DataOutputStream out=new DataOutputStream(bytes)){out.writeInt(MAGIC);out.writeInt(VERSION);out.writeInt(saved.rows.size());for(Map<String,Object> raw:saved.rows.values()){Map<String,Object> row=validate(raw);out.writeUTF((String)row.get("id"));out.writeLong((Long)row.get("ownerUserId"));out.writeLong((Long)row.get("tenantId"));out.writeUTF((String)row.get("number"));out.writeLong((Long)row.get("startedAt"));out.writeLong((Long)row.get("endedAt"));out.writeLong((Long)row.get("updatedAt"));out.writeBoolean(row.containsKey("answeredAt"));if(row.containsKey("answeredAt"))out.writeLong((Long)row.get("answeredAt"));}out.writeInt(saved.acknowledged.size());for(Map.Entry<String,Long> ack:saved.acknowledged.entrySet()){out.writeUTF(ack.getKey());out.writeLong(ack.getValue());}}byte[] result=bytes.toByteArray();if(result.length>MAX_BYTES)throw new IOException();return result;}
  private static Snapshot decode(byte[] bytes)throws IOException{if(bytes.length>MAX_BYTES)throw new IOException();Snapshot result=new Snapshot();try(DataInputStream in=new DataInputStream(new ByteArrayInputStream(bytes))){if(in.readInt()!=MAGIC||in.readInt()!=VERSION)throw new IOException();int count=in.readInt();if(count<0||count>LIMIT)throw new IOException();for(int i=0;i<count;i++){Map<String,Object> row=new LinkedHashMap<>();row.put("id",in.readUTF());row.put("ownerUserId",in.readLong());row.put("tenantId",in.readLong());row.put("number",in.readUTF());row.put("direction","inbound");row.put("startedAt",in.readLong());row.put("endedAt",in.readLong());row.put("updatedAt",in.readLong());if(in.readBoolean())row.put("answeredAt",in.readLong());row=validate(row);if(result.rows.put((String)row.get("id"),row)!=null)throw new IOException();}int acks=in.readInt();if(acks<0||acks>ACK_LIMIT)throw new IOException();for(int i=0;i<acks;i++){String id=in.readUTF();long at=in.readLong();if(!id(id)||at<=0||at>MAX_SAFE||result.acknowledged.put(id,at)!=null||result.rows.containsKey(id))throw new IOException();}if(in.read()!=-1)throw new IOException();}return result;}
  static byte[] encrypt(byte[] plain,SecretKey key)throws Exception{if(plain.length>MAX_BYTES)throw new IOException();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);byte[] iv=cipher.getIV();if(iv.length!=12)throw new IOException();byte[] encrypted=cipher.doFinal(plain),result=new byte[1+iv.length+encrypted.length];result[0]=(byte)iv.length;System.arraycopy(iv,0,result,1,iv.length);System.arraycopy(encrypted,0,result,1+iv.length,encrypted.length);return result;}
  static byte[] decrypt(byte[] encrypted,SecretKey key)throws Exception{if(encrypted.length<30||encrypted.length>MAX_BYTES+29||encrypted[0]!=12)throw new IOException();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,encrypted,1,12));return cipher.doFinal(encrypted,13,encrypted.length-13);}
}
