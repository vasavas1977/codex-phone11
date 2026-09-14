package ai.phone11.siprix;
import java.util.Map;
/** Pure guards shared by the bridge and JVM regression tests. */
public final class LabScope {
 public static String destination(String value) {
  if(value==null)throw new SecurityException();
  if(value.matches("sip:(7102|7190|7191)@10\\.0\\.2\\.2(?::15060)?"))value=value.substring(4,value.indexOf('@'));
  if(!value.matches("7102|7190|7191"))throw new SecurityException();return value;
 }
 public static boolean connected(Map<String,Object> call,long now) {
  if(call==null||call.containsKey("answeredAt"))return false;
  call.put("answeredAt",(double)now);return true;
 }
}
