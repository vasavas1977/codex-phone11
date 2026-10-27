package ai.phone11.siprix;

import android.content.*;
import android.os.Bundle;
import android.telecom.*;
import android.net.Uri;

/** System-managed arbitration for one self-managed native incoming audio call. */
@SuppressWarnings("deprecation")
public final class Phone11ConnectionService extends ConnectionService {
  private static PhoneAccountHandle handle(Context context){return new PhoneAccountHandle(new ComponentName(context,Phone11ConnectionService.class),"phone11-native-wake");}
  static boolean register(Context context){if(!BuildConfig.WAKE_CANDIDATE_ENABLED)return false;try{TelecomManager telecom=context.getSystemService(TelecomManager.class);PhoneAccountHandle handle=handle(context);telecom.registerPhoneAccount(PhoneAccount.builder(handle,"Phone11").setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED).build());return telecom.getPhoneAccount(handle)!=null;}catch(RuntimeException failure){return false;}}
  static void incoming(Context context,Phone11AndroidWakeState.Ticket ticket){Bundle extras=new Bundle();extras.putString("callUUID",ticket.callUUID);extras.putString("bindingId",ticket.bindingId);extras.putLong("epoch",ticket.epoch);try{context.getSystemService(TelecomManager.class).addNewIncomingCall(handle(context),extras);}catch(RuntimeException failure){Phone11AndroidWakeCoordinator.get(context).end(ticket.callUUID,ticket.bindingId,ticket.epoch);}}
  @Override public Connection onCreateIncomingConnection(PhoneAccountHandle manager,ConnectionRequest request){Bundle extras=request.getExtras();Call call=new Call(this,extras==null?new Bundle():extras);Phone11AndroidWakeCoordinator.get(this).connection(call,call.uuid,call.binding,call.epoch);return call;}
  @Override public void onCreateIncomingConnectionFailed(PhoneAccountHandle manager,ConnectionRequest request){Bundle extras=request.getExtras();if(extras!=null)Phone11AndroidWakeCoordinator.get(this).end(extras.getString("callUUID"),extras.getString("bindingId"),extras.getLong("epoch"));}
  static final class Call extends Connection {
    final Context context;final String uuid,binding;final long epoch;
    Call(Context context,Bundle extras){this.context=context;uuid=extras.getString("callUUID");binding=extras.getString("bindingId");epoch=extras.getLong("epoch");setConnectionProperties(PROPERTY_SELF_MANAGED);setAudioModeIsVoip(true);setAddress(Uri.fromParts("sip","Phone11",null),TelecomManager.PRESENTATION_RESTRICTED);setCallerDisplayName("Phone11",TelecomManager.PRESENTATION_ALLOWED);setInitializing();}
    @Override public void onAnswer(){Phone11AndroidWakeCoordinator.get(context).answer(uuid,binding,epoch);}
    @Override public void onReject(){Phone11AndroidWakeCoordinator.get(context).end(uuid,binding,epoch);}
    @Override public void onDisconnect(){Phone11AndroidWakeCoordinator.get(context).end(uuid,binding,epoch);}
    @Override public void onAbort(){Phone11AndroidWakeCoordinator.get(context).end(uuid,binding,epoch);}
    void ended(){setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));destroy();}
  }
}
