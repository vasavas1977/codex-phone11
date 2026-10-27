package ai.phone11.siprix;
import java.util.*;
import javax.crypto.*;
import java.nio.charset.StandardCharsets;

/** Real JVM AES-GCM and synthetic disk failure tests; no Android/device claim. */
final class AndroidWakeHistoryTest {
  static int checks;static long now=1_000_000;
  static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
  static void fail(String code,Runnable operation){try{operation.run();throw new AssertionError("Expected "+code);}catch(Phone11WakeHistoryState.Failure error){check(code.equals(error.code));}}
  static final String CALL="11111111-1111-4111-8111-111111111111";
  static Map<String,Object> binding(long user,long tenant,String session){Map<String,Object> result=new LinkedHashMap<>();result.put("bindingId","22222222-2222-4222-8222-222222222222");result.put("sessionBinding",session);result.put("ownerUserId",user);result.put("tenantId",tenant);result.put("deviceId","device-synthetic");result.put("expiresAt",100_000_000_000L);return result;}
  static Map<String,Object> call(){Map<String,Object> result=new HashMap<>();result.put("direction","incoming");result.put("state","terminated");result.put("startedAt",now-1000);result.put("remoteUri","sip:+6620303883@example.test");result.put("password","NEVER_SAVE_THIS_CONFIG");return result;}
  static final class Disk implements Phone11WakeHistoryState.Storage{
    byte[] encrypted;boolean readFails,writeFails,resetFails,deleteFails;int writes;SecretKey key;
    Disk()throws Exception{rotate();}
    void rotate()throws Exception{KeyGenerator generator=KeyGenerator.getInstance("AES");generator.init(256);key=generator.generateKey();}
    public byte[] read()throws Exception{if(readFails)throw new java.io.IOException();return encrypted==null?null:Phone11WakeHistoryState.decrypt(encrypted,key);}
    public void write(byte[] bytes)throws Exception{if(writeFails)throw new java.io.IOException();encrypted=Phone11WakeHistoryState.encrypt(bytes,key);writes++;}
    public void reset()throws Exception{if(resetFails)throw new java.io.IOException();rotate();if(deleteFails)throw new java.io.IOException();encrypted=null;}
    Phone11WakeHistoryState state(){return new Phone11WakeHistoryState(this,()->now);}
  }
  public static void main(String[] args)throws Exception{
    Map<String,Object> a=binding(17,10,"33333333-3333-4333-8333-333333333333"),b=binding(18,10,"44444444-4444-4444-8444-444444444444"),otherTenant=binding(17,20,"33333333-3333-4333-8333-333333333333");
    Disk disk=new Disk();Phone11WakeHistoryState state=disk.state();Map<String,Object> event=call();event.put("answeredAt",now-500);state.record(a,CALL,event);
    check(!new String(disk.encrypted,StandardCharsets.UTF_8).contains("+6620303883"));byte[] plaintext=disk.read();String plain=new String(plaintext,StandardCharsets.ISO_8859_1);check(!plain.contains("password")&&!plain.contains("NEVER_SAVE")&&!plain.contains("example.test")&&!plain.contains("sessionBinding"));Arrays.fill(plaintext,(byte)0);
    if(args.length==1&&"--fixture".equals(args[0])){Map<String,Object> sample=state.read(a,a).get(0);StringJoiner json=new StringJoiner(",","{","}");for(Map.Entry<String,Object> value:sample.entrySet())json.add("\""+value.getKey()+"\":"+(value.getValue() instanceof String?"\""+value.getValue()+"\"":value.getValue().toString()));System.out.println(json);return;}
    List<Map<String,Object>> rows=state.read(a,a);check(rows.size()==1);Map<String,Object> row=rows.get(0);check(row.size()==9&&("native-wake:"+CALL).equals(row.get("id"))&&"+6620303883".equals(row.get("number"))&&"inbound".equals(row.get("direction")));check(Long.valueOf(now).equals(row.get("endedAt")));check(Long.valueOf(17).equals(row.get("ownerUserId")));check(Long.valueOf(now-500).equals(row.get("answeredAt")));
    // Process recreation reopens authenticated ciphertext; no JS or credential state required.
    state=disk.state();check(state.read(a,a).size()==1);check(state.read(b,b).isEmpty());check(state.read(otherTenant,otherTenant).isEmpty());
    final Phone11WakeHistoryState restored=state;fail("E_HISTORY_OWNER",()->restored.read(a,b));Map<String,Object> renewed=binding(17,10,"55555555-5555-4555-8555-555555555555");fail("E_HISTORY_OWNER",()->restored.ack(a,renewed,Arrays.asList("native-wake:"+CALL)));check(state.read(renewed,renewed).size()==1);
    state.ack(b,b,Arrays.asList("native-wake:"+CALL));check(state.read(a,a).size()==1);state.ack(a,a,Arrays.asList("native-wake:66666666-6666-4666-8666-666666666666"));check(state.read(a,a).size()==1);
    // ID is immutable despite duplicate/reordered callbacks and returned-map mutation.
    Map<String,Object> changed=call();changed.put("remoteUri","sip:attacker@example.test");now+=1000;state.record(a,CALL,changed);rows=state.read(a,a);check("+6620303883".equals(rows.get(0).get("number")));rows.get(0).put("number","edited");check("+6620303883".equals(state.read(a,a).get(0).get("number")));
    // Failed ack never deletes, and successful ack suppresses duplicate termination after restart.
    disk.writeFails=true;final Phone11WakeHistoryState st=state;fail("E_HISTORY_STORAGE",()->st.ack(a,a,Arrays.asList("native-wake:"+CALL)));disk.writeFails=false;check(state.read(a,a).size()==1);state.ack(a,a,Arrays.asList("native-wake:"+CALL));state.ack(a,a,Arrays.asList("native-wake:"+CALL));state=disk.state();state.record(a,CALL,call());check(state.read(a,a).isEmpty());
    // Failed append retains pending data and leaves existing encrypted bytes untouched.
    final String next="77777777-7777-4777-8777-777777777777";byte[] before=disk.encrypted.clone();disk.writeFails=true;final Phone11WakeHistoryState pending=state;fail("E_HISTORY_STORAGE",()->pending.record(a,next,call()));check(Arrays.equals(before,disk.encrypted));disk.writeFails=false;check(state.read(a,a).size()==1);check(disk.state().read(a,a).size()==1);
    disk.readFails=true;before=disk.encrypted.clone();fail("E_HISTORY_STORAGE",()->pending.ack(a,a,Arrays.asList("native-wake:"+next)));check(Arrays.equals(before,disk.encrypted));disk.readFails=false;check(state.read(a,a).size()==1);
    fail("E_INVALID_ARGUMENT",()->pending.ack(a,a,Arrays.asList("not-an-id")));Map<String,Object> malformed=call();malformed.put("direction","outgoing");fail("E_INVALID_ARGUMENT",()->pending.record(a,UUID.randomUUID().toString(),malformed));Map<String,Object> invalidIdentity=new HashMap<>(a);invalidIdentity.put("ownerUserId",1.5);fail("E_HISTORY_OWNER",()->pending.read(invalidIdentity,invalidIdentity));Map<String,Object> expired=new HashMap<>(a);expired.put("expiresAt",now);fail("E_HISTORY_OWNER",()->pending.read(expired,expired));
    check("Unknown".equals(Phone11WakeHistoryState.number("Alice <sip:123@example.test>")));check("Unknown".equals(Phone11WakeHistoryState.number("sip:user:password@example.test")));check("Unknown".equals(Phone11WakeHistoryState.number("https://secret.example")));check("1001".equals(Phone11WakeHistoryState.number("sip:1001@example.test")));
    // Authenticated ciphertext corruption cannot overwrite or clear prior history.
    disk.encrypted[20]^=1;before=disk.encrypted.clone();fail("E_HISTORY_STORAGE",()->pending.read(a,a));check(Arrays.equals(before,disk.encrypted));disk.encrypted[20]^=1;check(state.read(a,a).size()==1);
    Disk malformedDisk=new Disk();java.io.ByteArrayOutputStream invalidBytes=new java.io.ByteArrayOutputStream();
    try(java.io.DataOutputStream out=new java.io.DataOutputStream(invalidBytes)){out.writeInt(0x50313148);out.writeInt(1);out.writeInt(1);out.writeUTF("native-wake:"+CALL);out.writeLong(17);out.writeLong(10);out.writeUTF("123");out.writeLong(5000);out.writeLong(1000);out.writeLong(1000);out.writeBoolean(false);out.writeInt(0);}
    malformedDisk.write(invalidBytes.toByteArray());byte[] invalidSaved=malformedDisk.encrypted.clone();fail("E_HISTORY_STORAGE",()->malformedDisk.state().read(a,a));check(Arrays.equals(invalidSaved,malformedDisk.encrypted));
    // Missing/corrupt disk reads never become an empty replacement on append.
    malformedDisk.readFails=true;fail("E_HISTORY_STORAGE",()->malformedDisk.state().record(a,CALL,call()));check(Arrays.equals(invalidSaved,malformedDisk.encrypted));
    Disk bounded=new Disk();Phone11WakeHistoryState limit=bounded.state();for(int i=0;i<110;i++){now+=1;limit.record(a,UUID.randomUUID().toString(),call());}check(limit.read(a,a).size()==100);now+=31L*86400000L;check(limit.read(a,a).isEmpty());check(bounded.encrypted.length<Phone11WakeHistoryState.MAX_BYTES);
    limit.record(a,UUID.randomUUID().toString(),call());limit.clear();check(bounded.state().read(a,a).isEmpty());
    // Logout always clears failed in-memory appends and denies same-owner
    // re-enrollment until the explicit reset can finish.
    Disk logout=new Disk();Phone11WakeHistoryState loggedOut=logout.state();logout.writeFails=true;
    fail("E_HISTORY_STORAGE",()->loggedOut.record(a,CALL,call()));logout.resetFails=true;
    fail("E_HISTORY_STORAGE",loggedOut::clear);logout.writeFails=false;
    fail("E_HISTORY_STORAGE",()->loggedOut.read(renewed,renewed));
    logout.resetFails=false;check(loggedOut.read(renewed,renewed).isEmpty());
    // Durable key invalidation prevents a process-recreated reader from
    // decrypting stale ciphertext even when file deletion itself fails.
    loggedOut.record(a,CALL,call());logout.deleteFails=true;
    fail("E_HISTORY_STORAGE",loggedOut::clear);Phone11WakeHistoryState recreated=logout.state();
    fail("E_HISTORY_STORAGE",()->recreated.read(renewed,renewed));
    logout.deleteFails=false;recreated.clear();check(recreated.read(renewed,renewed).isEmpty());
    System.out.println("PASS "+checks+" encrypted completed-wake history assertions; synthetic storage only");
  }
}
