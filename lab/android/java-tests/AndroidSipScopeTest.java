import ai.phone11.siprix.AndroidSipScope;
import java.util.*;

public class AndroidSipScopeTest {
 public static void main(String[] args) {
  int assertions = 0;
  AndroidSipScope scope = new AndroidSipScope(
   "ai.phone11.staging", "ai.phone11.staging", "sip.staging.example", "16060", "8201", "8202,+6620000000"
  );
  assert scope.host().equals("sip.staging.example"); assertions++;
  assert scope.port() == 16060; assertions++;
  assert scope.account("8201").equals("8201"); assertions++;
  for (String value : List.of("8202", "+6620000000", "sip:8202@sip.staging.example", "sip:+6620000000@sip.staging.example:16060")) {
   assert scope.destination(value).equals(value.startsWith("sip:") ? value.substring(4, value.indexOf('@')) : value); assertions++;
  }
  for (String value : List.of("911", "sip:8202@evil.invalid", "sip:8202@sip.staging.example:5060", "sip:8202@sip.staging.example;transport=tcp", "sip:8202@sip.staging.example@evil.invalid", "8201", "8202\r\n")) {
   assert rejected(() -> scope.destination(value)) : value; assertions++;
  }
  assert rejected(() -> scope.account("8202")); assertions++;
  assert rejected(() -> new AndroidSipScope("ai.phone11.mobile", "ai.phone11.staging", "sip.staging.example", "16060", "8201", "8202")); assertions++;
  assert rejected(() -> new AndroidSipScope("ai.phone11.staging", "ai.phone11.staging", "https://sip.staging.example", "16060", "8201", "8202")); assertions++;
  assert rejected(() -> new AndroidSipScope("ai.phone11.staging", "ai.phone11.staging", "sip.staging.example", "0", "8201", "8202")); assertions++;
  assert rejected(() -> new AndroidSipScope("ai.phone11.staging", "ai.phone11.staging", "sip.staging.example", "16060", "8201", "8202,8202")); assertions++;
  System.out.println(assertions + " injected Android SIP scope assertions passed (L0, no SIP SDK execution)");
 }

 private static boolean rejected(Runnable action) {
  try { action.run(); return false; } catch (SecurityException expected) { return true; }
 }
}
