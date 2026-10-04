package ai.phone11.siprix;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.*;
public final class Phone11SiprixPackage implements ReactPackage {
  // The pinned legacy ReactPackage API remains the host contract for this slice.
  @SuppressWarnings("deprecation")
  @Override public List<NativeModule> createNativeModules(ReactApplicationContext context){return Collections.singletonList(new Phone11SiprixModule(context));}
  @SuppressWarnings("rawtypes")
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context){return Collections.emptyList();}
}
