package ai.phone11.siprix;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import com.siprix.*;
import java.util.*;

/** Exact Android 1.1.0 binding. No credentials retained in Java state, services, logging, or push. */
public final class SiprixAndroidAdapter implements Phone11CallRuntime.Engine {
  private final Context context; private final Handler main=new Handler(Looper.getMainLooper());
  private SiprixCore core; private Callbacks activeCallbacks;
  public SiprixAndroidAdapter(Context context){this.context=context.getApplicationContext();}
  private static void ok(int code){if(code!=SiprixCore.kOK)throw new Phone11CallRuntime.Failure("E_SIPRIX_"+code);}
  private SiprixCore sdk(){if(core==null)throw new Phone11CallRuntime.Failure("E_NOT_INITIALIZED");return core;}
  private void microphone(){Phone11ForegroundTrial.requireMicrophone(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED);}
  public String initialize(Phone11CallRuntime.Listener listener){
    if(core==null)core=new SiprixCore(context);
    String version=core.getVersion();
    if(version==null||!version.trim().matches("(?:Siprix: ?)?1\\.1\\.0 from 20260905_1222"))throw new Phone11CallRuntime.Failure("E_SDK_VERSION");
    activeCallbacks=new Callbacks(listener);core.setModelListener(activeCallbacks);
    IniData config=new IniData();config.setLogLevelFile(IniData.LogLevel.NONE);config.setLogLevelIde(IniData.LogLevel.NONE);
    config.setTlsVerifyServer(true);config.setSingleCallMode(true);config.setEnableVideoCall(false);
    config.setUseProximity(false);config.setUseTelState(false);config.setUseVolChange(false);
    config.setUnregOnDestroy(true);config.setBrandName("Phone11");ok(core.initialize(config));return version;
  }
  public void destroy(){if(core!=null){if(core.isInitialized())ok(core.unInitialize());core.setModelListener(null);activeCallbacks=null;}}
  private static String string(Map<String,Object> cfg,String key,boolean required){Object value=cfg.get(key);if(value==null){if(required)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return null;}
    if(!(value instanceof String)||((String)value).isEmpty()||((String)value).length()>256||((String)value).indexOf('\0')>=0||((String)value).indexOf('\r')>=0||((String)value).indexOf('\n')>=0)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return (String)value;}
  private static boolean bool(Map<String,Object> cfg,String key,boolean fallback){if(!cfg.containsKey(key))return fallback;Object value=cfg.get(key);if(!(value instanceof Boolean))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return (Boolean)value;}
  private static int number(Map<String,Object> cfg,String key,int fallback,int min,int max){if(!cfg.containsKey(key))return fallback;Object value=cfg.get(key);if(!(value instanceof Number))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");double n=((Number)value).doubleValue();if(!Double.isFinite(n)||n!=Math.rint(n)||n<min||n>max)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");return (int)n;}
  public int addAccount(Map<String,Object> cfg){
    Set<String> keys=new HashSet<>(Arrays.asList("sipServer","sipExtension","sipPassword","sipAuthId","sipProxy","stunServer","displName","transport","port","expireTime","secureMedia","iceEnabled","rtcpMuxEnabled","rewriteContactIp","verifyIncomingCall","forceSipProxy","aCodecs"));
    if(cfg==null||!keys.containsAll(cfg.keySet())||cfg.values().contains(null))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");
    String host=string(cfg,"sipServer",true),extension=string(cfg,"sipExtension",true),password=string(cfg,"sipPassword",true),transport=string(cfg,"transport",true);
    if(!host.matches("(?i)[a-z0-9.-]+(?::[0-9]{1,5})?")||!extension.matches("[+a-zA-Z0-9_.-]{1,128}")||!Arrays.asList("UDP","TCP","TLS").contains(transport))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");
    String auth=string(cfg,"sipAuthId",false),proxy=string(cfg,"sipProxy",false),stun=string(cfg,"stunServer",false),display=string(cfg,"displName",false);
    if((proxy!=null&&!proxy.matches("(?i)(?:sips?:)?[a-z0-9.-]+(?::[0-9]{1,5})?"))||(stun!=null&&!stun.matches("(?i)[a-z0-9.-]+(?::[0-9]{1,5})?")))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");
    int port=number(cfg,"port",0,0,65535),secure=number(cfg,"secureMedia",0,0,2);number(cfg,"expireTime",0,0,86400);
    List<AccData.AudioCodec> codecs=new ArrayList<>();if(cfg.containsKey("aCodecs")){Object list=cfg.get("aCodecs");if(!(list instanceof List)||((List<?>)list).isEmpty()||((List<?>)list).size()>10)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");
      for(Object raw:(List<?>)list){if(!(raw instanceof Number))throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");double code=((Number)raw).doubleValue();AccData.AudioCodec match=null;for(AccData.AudioCodec codec:AccData.AudioCodec.values())if(code==codec.getValue())match=codec;if(match==null)throw new Phone11CallRuntime.Failure("E_INVALID_ARGUMENT");codecs.add(match);}}
    // Validate all values before constructing native credential-bearing AccData.
    boolean ice=bool(cfg,"iceEnabled",false),rtcp=bool(cfg,"rtcpMuxEnabled",false),rewrite=bool(cfg,"rewriteContactIp",true),verify=bool(cfg,"verifyIncomingCall",true),force=bool(cfg,"forceSipProxy",false);
    AccData data=new AccData();data.setSipServer(host);data.setSipExtension(extension);data.setSipPassword(password);data.setExpireTime(0);
    data.setTranspProtocol(AccData.SipTransport.valueOf(transport));data.setTranspPort(port);data.setSecureMediaMode(AccData.SecureMediaMode.fromInt(secure));
    data.setUpgradeToVideoMode(AccData.UpgradeToVideoMode.INACTIVE);data.setIceEnabled(ice);data.setRtcpMuxEnabled(rtcp);data.setRewriteContactIp(rewrite);data.setVerifyIncomingCall(verify);data.setForceSipProxy(force);
    if(auth!=null)data.setSipAuthId(auth);if(proxy!=null)data.setSipProxyServer(proxy);if(stun!=null)data.setStunServer(stun);if(display!=null)data.setDisplayName(display);
    if(!codecs.isEmpty()){data.resetAudioCodecs();for(AccData.AudioCodec codec:codecs)data.addAudioCodec(codec);}
    SiprixCore.IdOutArg out=new SiprixCore.IdOutArg();try{ok(sdk().accountAdd(data,out));return out.value;}finally{data.setSipPassword("");data.setSipAuthId("");}
  }
  public void register(int id,int expiry){ok(sdk().accountRegister(id,expiry));}
  public void unregister(int id){ok(sdk().accountUnregister(id));}
  public void delete(int id){ok(sdk().accountDelete(id));}
  public int invite(int account,String destination){microphone();DestData dest=new DestData();dest.setAccountId(account);dest.setExtension(destination);dest.setVideoCall(false);dest.setInviteTimeout(30);SiprixCore.IdOutArg out=new SiprixCore.IdOutArg();ok(sdk().callInvite(dest,out));return out.value;}
  public void answer(int id){microphone();ok(sdk().callAccept(id,false));}
  public void end(int id,boolean reject){ok(reject?sdk().callReject(id,486):sdk().callBye(id));}
  public void mute(int id,boolean value){ok(sdk().callMuteMic(id,value));}
  public void rejectVideo(int id){ok(sdk().callAcceptVideoUpgrade(id,false));}
  public int holdState(int id){SiprixCore.IdOutArg out=new SiprixCore.IdOutArg();ok(sdk().callGetHoldState(id,out));return out.value;}
  public void toggleHold(int id){ok(sdk().callHold(id));}
  public void dtmf(int id,String digits){ok(sdk().callSendDtmf(id,digits));}
  public boolean speaker(){return sdk().dvcGetSelAudioDevice()==SiprixCore.AudioDevice.SpeakerPhone;}
  public void speaker(boolean value){SiprixCore.AudioDevice desired=value?SiprixCore.AudioDevice.SpeakerPhone:SiprixCore.AudioDevice.Earpiece;boolean found=false;for(int i=0;i<sdk().dvcGetAudioDevices();i++)found|=sdk().dvcGetAudioDevice(i)==desired;
    if(!found)throw new Phone11CallRuntime.Failure("E_AUDIO_ROUTE_UNAVAILABLE");sdk().dvcSetAudioDevice(desired);}
  private final class Callbacks implements ISiprixModelListener {
    private final Phone11CallRuntime.Listener listener;Callbacks(Phone11CallRuntime.Listener listener){this.listener=listener;}
    private void enqueue(Runnable action){main.post(()->{if(activeCallbacks==this)action.run();});}
    public void onAccountRegState(int n,AccData.RegState state,String response){enqueue(()->listener.registration(n,state.getValue(),response));}
    public void onCallIncoming(int n,int account,boolean video,String from,String to){enqueue(()->listener.incoming(n,account,video,from));}
    public void onCallProceeding(int n,String response){enqueue(()->listener.proceeding(n));}
    public void onCallConnected(int n,String from,String to,boolean video){enqueue(()->listener.connected(n,video));}
    public void onCallTerminated(int n,int status){enqueue(()->listener.terminated(n,status));}
    public void onCallHeld(int n,SiprixCore.HoldState state){enqueue(()->listener.held(n,state.getValue()));}
    public void onTrialModeNotified(){enqueue(()->listener.trial());}
    public void onDevicesAudioChanged(){enqueue(()->listener.audio());}
    public void onNetworkState(String name,SiprixCore.NetworkState state){enqueue(()->listener.network(state.getValue()));}
    public void onCallDtmfReceived(int n,int tone){enqueue(()->listener.dtmf(n,tone));}
    public void onCallVideoUpgradeRequested(int n){enqueue(()->listener.videoUpgrade(n));}
    public void onSubscriptionState(int n,SubscrData.SubscrState state,String response){}
    public void onPlayerState(int n,SiprixCore.PlayerState state){}
    public void onCallTransferred(int n,int status){} public void onCallRedirected(int n,int related,String to){}
    public void onCallVideoUpgraded(int n,boolean video){enqueue(()->listener.connected(n,video));} public void onCallSwitched(int n){}
    public void onMessageSentState(int n,boolean success,String response){} public void onMessageIncoming(int n,int account,String from,String body){}
    public void onSipNotify(int n,String header,String body){} public void onVuMeterLevel(int mic,int speaker){}
  }
}
