package ai.phone11.siprix;
import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
/** Selected only in the explicit Firebase-configured wake candidate. */
final class Phone11WakeProvider {
  interface Result{void done(String token);void failed();}
  static boolean available(Context context){try{return FirebaseApp.initializeApp(context)!=null;}catch(RuntimeException failure){return false;}}
  static void token(Context context,Result result){if(!available(context)){result.failed();return;}FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->{if(task.isSuccessful()&&task.getResult()!=null)result.done(task.getResult());else result.failed();});}
}
