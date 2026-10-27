package ai.phone11.siprix;
import android.content.Context;
/** Default builds never initialize Firebase or return a simulated token. */
final class Phone11WakeProvider {
  interface Result{void done(String token);void failed();}
  static boolean available(Context context){return false;}
  static void token(Context context,Result result){result.failed();}
}
