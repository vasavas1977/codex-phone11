import ai.phone11.siprix.LabScope;
import java.util.*;
public class LabScopeTest {
 public static void main(String[] args){
  int assertions=0;
  for(String s:List.of("7102","7190","7191","sip:7102@10.0.2.2","sip:7190@10.0.2.2:15060")){assert LabScope.destination(s).matches("7102|7190|7191");assertions++;}
  for(String s:List.of("+6620303001","911","sip:7102@evil.invalid","sip:7102@10.0.2.2:5060","sip:7190@10.0.2.2;transport=tcp","sip:7190@10.0.2.2@evil.invalid","sip:7101@10.0.2.2","7102\r\n")){
   boolean rejected=false;try{LabScope.destination(s);}catch(SecurityException e){rejected=true;}assert rejected:s;assertions++;
  }
  Map<String,Object> c=new HashMap<>();c.put("state","connected");assert LabScope.connected(c,123);assertions++;
  c.put("state","held");assert !LabScope.connected(c,456);assert (double)c.get("answeredAt")==123;assert c.get("state").equals("held");assertions+=3;
  assert !LabScope.connected(null,456);assertions++;
  System.out.println(assertions+" native guard assertions passed (L0, no SIP SDK execution)");
 }
}
