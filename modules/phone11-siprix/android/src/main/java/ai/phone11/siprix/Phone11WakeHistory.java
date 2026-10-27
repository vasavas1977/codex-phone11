package ai.phone11.siprix;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.security.KeyStore;
import java.util.*;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Android device-bound encrypted spool. The coordinator owns authorization and
 * calls these methods on its serialized queue with a freshly validated binding.
 * Committed records survive process recreation. Session rotation does not change
 * their captured owner/tenant; the renewed current binding must authorize import.
 * Logout policy is explicit through clear(), which reports storage failure rather
 * than pretending deletion succeeded. Pending failed appends are memory-only until
 * a later successful operation, and cannot survive process death during disk failure. */
final class Phone11WakeHistory {
  private static final String KEY="phone11.android.completed-wake-history.v1";
  private final Phone11WakeHistoryState history;
  Phone11WakeHistory(Context context){
    final AtomicFile file=new AtomicFile(new File(context.getNoBackupFilesDir(),"phone11-completed-wake-history.bin"));
    history=new Phone11WakeHistoryState(new Phone11WakeHistoryState.Storage(){
      public byte[] read()throws Exception{
        // openRead performs AtomicFile crash/backup recovery before inspection.
        // Never mistake a recoverable .bak for an empty history and overwrite it.
        try(FileInputStream input=file.openRead()){
          if(input.getChannel().size()>Phone11WakeHistoryState.MAX_BYTES+29)throw new IOException();
          ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;
          while((count=input.read(buffer))!=-1){if(bytes.size()+count>Phone11WakeHistoryState.MAX_BYTES+29)throw new IOException();bytes.write(buffer,0,count);}
          return Phone11WakeHistoryState.decrypt(bytes.toByteArray(),key());
        }catch(FileNotFoundException missing){
          File parent=file.getBaseFile().getParentFile();
          if(parent!=null&&parent.isDirectory()&&parent.canRead()&&parent.canWrite()&&
              !file.getBaseFile().exists()&&!new File(file.getBaseFile().getPath()+".bak").exists())return null;
          throw missing;
        }
      }
      public void write(byte[] bytes)throws Exception{
        byte[] encrypted=Phone11WakeHistoryState.encrypt(bytes,key());FileOutputStream out=null;
        try{out=file.startWrite();out.write(encrypted);file.finishWrite(out);}catch(Exception failure){if(out!=null)file.failWrite(out);throw failure;}finally{Arrays.fill(encrypted,(byte)0);}
      }
      public void reset()throws Exception{
        // Erase the dedicated key first. Even a failed file deletion or a crash
        // between these operations cannot revive decryptable prior-owner rows.
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(KEY);
        if(keys.containsAlias(KEY))throw new IOException();
        file.delete();
        for(String suffix:new String[]{"",".bak",".new"})if(new File(file.getBaseFile().getPath()+suffix).exists())throw new IOException();
      }
    },System::currentTimeMillis);
  }
  private static SecretKey key()throws Exception{
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias(KEY)){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(KEY,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());generator.generateKey();}
    return (SecretKey)store.getKey(KEY,null);
  }
  void record(Map<String,Object> capturedBinding,String callUUID,Map<String,Object> terminatedCall){try{history.record(capturedBinding,callUUID,terminatedCall);}catch(Phone11WakeHistoryState.Failure failure){throw new Phone11CallRuntime.Failure(failure.code);}}
  List<Map<String,Object>> read(Map<String,Object> requestedBinding,Map<String,Object> authoritativeCurrentBinding){try{return history.read(requestedBinding,authoritativeCurrentBinding);}catch(Phone11WakeHistoryState.Failure failure){throw new Phone11CallRuntime.Failure(failure.code);}}
  void ack(Map<String,Object> requestedBinding,Map<String,Object> authoritativeCurrentBinding,List<String> ids){try{history.ack(requestedBinding,authoritativeCurrentBinding,ids);}catch(Phone11WakeHistoryState.Failure failure){throw new Phone11CallRuntime.Failure(failure.code);}}
  void clear(){try{history.clear();}catch(Phone11WakeHistoryState.Failure failure){throw new Phone11CallRuntime.Failure(failure.code);}}
}
