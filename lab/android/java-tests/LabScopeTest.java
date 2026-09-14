import ai.phone11.siprix.LabScope;
import java.util.*;
public class LabScopeTest {
 public static void main(String[] args){
  int assertions=0;
  Map<String,Object> c=new HashMap<>();c.put("state","connected");assert LabScope.connected(c,123);assertions++;
  c.put("state","held");assert !LabScope.connected(c,456);assert (double)c.get("answeredAt")==123;assert c.get("state").equals("held");assertions+=3;
  assert !LabScope.connected(null,456);assertions++;
  System.out.println(assertions+" native guard assertions passed (L0, no SIP SDK execution)");
 }
}
