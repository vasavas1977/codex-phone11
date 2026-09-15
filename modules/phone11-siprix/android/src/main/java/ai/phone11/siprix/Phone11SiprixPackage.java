package ai.phone11.siprix;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.*;
import com.facebook.react.uimanager.ViewManager;
import java.util.*;
public final class Phone11SiprixPackage implements ReactPackage {
 public List<NativeModule> createNativeModules(ReactApplicationContext c) { return Collections.singletonList(new Phone11SiprixModule(c)); }
 public List<ViewManager> createViewManagers(ReactApplicationContext c) { return Collections.emptyList(); }
}
