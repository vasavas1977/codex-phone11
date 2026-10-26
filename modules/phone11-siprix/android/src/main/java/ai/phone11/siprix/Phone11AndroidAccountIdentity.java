package ai.phone11.siprix;
import java.util.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/** Normalizes native/JSON numeric representation and excludes display-only data. */
final class Phone11AndroidAccountIdentity {
  static String fingerprint(Map<String,Object> config){try{
    TreeMap<String,Object> values=new TreeMap<>();
    for(String key:new String[]{"sipServer","sipExtension","sipPassword","transport"})values.put(key,config.get(key));
    values.put("sipAuthId",config.getOrDefault("sipAuthId",config.get("sipExtension")));
    for(String key:new String[]{"sipProxy","stunServer"})values.put(key,config.getOrDefault(key,""));
    values.put("port",integer(config.getOrDefault("port","TLS".equals(config.get("transport"))?5061:5060)));
    values.put("secureMedia",integer(config.getOrDefault("secureMedia",0)));
    for(String key:new String[]{"iceEnabled","rtcpMuxEnabled","forceSipProxy"})values.put(key,config.getOrDefault(key,false));
    for(String key:new String[]{"rewriteContactIp","verifyIncomingCall"})values.put(key,config.getOrDefault(key,true));
    Object codecs=config.get("aCodecs");if(codecs!=null){if(!(codecs instanceof List))throw new Exception();List<Long> list=new ArrayList<>();for(Object codec:(List<?>)codecs)list.add(integer(codec));values.put("aCodecs",list);}
    StringBuilder serialized=new StringBuilder();for(Map.Entry<String,Object> entry:values.entrySet()){if(entry.getValue()==null)throw new Exception();String value=entry.getValue().toString();serialized.append(entry.getKey().length()).append(':').append(entry.getKey()).append(value.length()).append(':').append(value);}
    byte[] digest=MessageDigest.getInstance("SHA-256").digest(serialized.toString().getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
  }catch(Exception failure){throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");}}
  private static long integer(Object value){if(!(value instanceof Number))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");double n=((Number)value).doubleValue();if(!Double.isFinite(n)||n!=Math.rint(n))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return ((Number)value).longValue();}
}
