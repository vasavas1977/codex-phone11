package ai.phone11.siprix;

import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.net.URI;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Handler;

/** Fixed-origin, bounded, no redirect/no cache wake-grant transport. Never logs response/config/grant. */
final class Phone11WakeHttp {
  interface Reply {void done(JSONObject result,boolean revoked);}
  private final ExecutorService worker=Executors.newSingleThreadExecutor();private final java.util.concurrent.ScheduledExecutorService watchdog=Executors.newSingleThreadScheduledExecutor();private final Handler main;
  Phone11WakeHttp(Handler main){this.main=main;}
  static String origin(){try{URI uri=new URI(BuildConfig.WAKE_ORIGIN);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||"/".equals(uri.getPath())))throw new Exception();return new URI(uri.getScheme(),null,uri.getHost(),uri.getPort(),null,null,null).toString();}catch(Exception failure){throw new Phone11CallRuntime.Failure("E_WAKE_ORIGIN");}}
  void request(String operation,JSONObject enrollment,Phone11AndroidWakeState.Ticket ticket,java.util.function.BooleanSupplier current,Reply reply){
    if(!java.util.Arrays.asList("claim","ready","status","end").contains(operation))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");
    final String endpoint=origin()+"/api/phone11/wake/"+operation;
    final long deadline=System.currentTimeMillis()+5000;
    worker.execute(()->{JSONObject result=null;boolean revoked=false;HttpsURLConnection connection=null;java.util.concurrent.atomic.AtomicReference<HttpsURLConnection> live=new java.util.concurrent.atomic.AtomicReference<>();java.util.concurrent.ScheduledFuture<?> timeout=watchdog.schedule(()->{HttpsURLConnection pending=live.get();if(pending!=null)pending.disconnect();},Math.max(0,deadline-System.currentTimeMillis()),java.util.concurrent.TimeUnit.MILLISECONDS);try{
      if(!current.getAsBoolean()||System.currentTimeMillis()>=deadline||(!"end".equals(operation)&&ticket.expiresAt<=System.currentTimeMillis()&&!"ready".equals(operation)))throw new IOException();
      connection=(HttpsURLConnection)new URI(endpoint).toURL().openConnection();live.set(connection);connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout((int)Math.max(1,deadline-System.currentTimeMillis()));connection.setReadTimeout((int)Math.max(1,deadline-System.currentTimeMillis()));connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Authorization","Wake "+enrollment.getString("grant"));
      byte[] body=new JSONObject().put("bindingId",ticket.bindingId).put("callUUID",ticket.callUUID).toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);if(!current.getAsBoolean()||System.currentTimeMillis()>=deadline)throw new IOException();try(OutputStream stream=connection.getOutputStream()){if(!current.getAsBoolean())throw new IOException();if(System.currentTimeMillis()>=deadline)throw new IOException();stream.write(body);}
      if(System.currentTimeMillis()>=deadline)throw new IOException();connection.setReadTimeout((int)Math.max(1,deadline-System.currentTimeMillis()));int status=connection.getResponseCode();if(System.currentTimeMillis()>=deadline)throw new IOException();revoked=status==401||status==403;
      if(status==200){try(InputStream stream=connection.getInputStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream()){byte[] bytes=new byte[2048];int n;while(true){connection.setReadTimeout((int)Math.max(1,deadline-System.currentTimeMillis()));n=stream.read(bytes);if(n==-1)break;if(!current.getAsBoolean()||System.currentTimeMillis()>deadline||buffer.size()+n>32768)throw new IOException();buffer.write(bytes,0,n);}JSONObject parsed=new JSONObject(buffer.toString(StandardCharsets.UTF_8.name()));if(parsed.opt("v") instanceof Number&&((Number)parsed.opt("v")).doubleValue()==1D&&ticket.callUUID.equals(parsed.optString("callUUID"))&&ticket.bindingId.equals(parsed.optString("bindingId"))&&parsed.opt("expiresAt") instanceof Number&&((Number)parsed.opt("expiresAt")).doubleValue()==ticket.expiresAt&&java.util.Arrays.asList("pending","ready","cancelled","expired","ended").contains(parsed.opt("status")))result=parsed;}}
    }catch(Exception ignored){/* Deliberately no raw diagnostic material. */}finally{timeout.cancel(false);if(connection!=null)connection.disconnect();}final JSONObject response=System.currentTimeMillis()<=deadline?result:null;final boolean rejected=revoked;main.post(()->reply.done(response,rejected));});
  }
}
