package ai.phone11.siprix;
import java.util.Map;
/** Pure guards shared by the bridge and JVM regression tests. */
public final class LabScope {
 public static boolean connected(Map<String,Object> call,long now) {
  if(call==null||call.containsKey("answeredAt"))return false;
  call.put("answeredAt",(double)now);return true;
 }
}
