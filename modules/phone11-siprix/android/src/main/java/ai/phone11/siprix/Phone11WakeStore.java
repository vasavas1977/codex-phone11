package ai.phone11.siprix;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Device-bound, no-backup grant only. SIP passwords and account configs never reach this store. */
final class Phone11WakeStore {
  private final AtomicFile file; private static final String KEY="phone11.android.wake.v1";
  Phone11WakeStore(Context context){file=new AtomicFile(new File(context.getNoBackupFilesDir(),"phone11-wake.bin"));}
  private javax.crypto.SecretKey key()throws Exception{
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias(KEY)){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(KEY,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());generator.generateKey();}
    return (javax.crypto.SecretKey)store.getKey(KEY,null);
  }
  synchronized JSONObject read(){byte[] plain=null;try{byte[] bytes;try(FileInputStream input=file.openRead();ByteArrayOutputStream buffer=new ByteArrayOutputStream()){if(input.getChannel().size()>8192)return null;byte[] part=new byte[1024];int count;while((count=input.read(part))!=-1){if(buffer.size()+count>8192)return null;buffer.write(part,0,count);}bytes=buffer.toByteArray();}if(bytes.length<30||bytes.length>8192)return null;int length=bytes[0]&255;if(length!=12)return null;Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,bytes,1,length));plain=cipher.doFinal(bytes,1+length,bytes.length-1-length);JSONObject value=new JSONObject(new String(plain,StandardCharsets.UTF_8));validate(value);return value;}catch(Exception failure){return null;}finally{if(plain!=null)java.util.Arrays.fill(plain,(byte)0);}}
  synchronized void write(JSONObject value){if(value==null){file.delete();return;}byte[] plain=null;FileOutputStream output=null;try{validate(value);plain=value.toString().getBytes(StandardCharsets.UTF_8);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] iv=cipher.getIV(),encrypted=cipher.doFinal(plain);output=file.startWrite();output.write(iv.length);output.write(iv);output.write(encrypted);file.finishWrite(output);}catch(Exception failure){if(output!=null)file.failWrite(output);throw new Phone11CallRuntime.Failure("E_WAKE_STORAGE");}finally{if(plain!=null)java.util.Arrays.fill(plain,(byte)0);}}
  static void validate(JSONObject value){try{if(value.length()!=7||!value.getString("grant").matches("[A-Za-z0-9_-]{43}"))throw new Exception();binding(value);}catch(Exception failure){throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");}}
  static Phone11AndroidWakeState.Binding binding(JSONObject value){try{
    return new Phone11AndroidWakeState.Binding(value.getString("bindingId"),identity(value,"ownerUserId"),identity(value,"tenantId"),value.getString("deviceId"),value.getString("sessionBinding"),timestamp(value.get("expiresAt")));
  }catch(Exception failure){throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");}}
  private static long timestamp(Object raw)throws Exception{if(!(raw instanceof Number))throw new Exception();double n=((Number)raw).doubleValue();if(!Double.isFinite(n)||n<=0||n>9007199254740991D||n!=Math.rint(n))throw new Exception();return ((Number)raw).longValue();}
  private static String identity(JSONObject value,String key)throws Exception{Object raw=value.get(key);if(!(raw instanceof Number))throw new Exception();double n=((Number)raw).doubleValue();if(!Double.isFinite(n)||n<1||n>9007199254740991D||n!=Math.rint(n))throw new Exception();return Long.toString(((Number)raw).longValue());}
  static java.util.Map<String,Object> publicBinding(JSONObject value){java.util.Map<String,Object> result=new java.util.LinkedHashMap<>();if(value==null)return null;for(String key:new String[]{"bindingId","ownerUserId","tenantId","deviceId","sessionBinding","expiresAt"})result.put(key,value.opt(key));return result;}
}
