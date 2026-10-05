package ai.phone11.siprix;

import java.util.Map;

/** Native trial boundaries, shared by the bridge and the exact SDK adapter. */
public final class Phone11ForegroundTrial {
  private Phone11ForegroundTrial() {}
  public static void requireSource(boolean buildEnabled, String packageName, boolean manifestEnabled) {
    if (!buildEnabled || !"ai.phone11.mobile.foregroundtrial".equals(packageName) || !manifestEnabled) {
      throw new Phone11CallRuntime.Failure("E_ANDROID_SOURCE_GATE");
    }
  }
  public static void requireForeground(boolean resumed) {
    if (!resumed) throw new Phone11CallRuntime.Failure("E_ANDROID_FOREGROUND_REQUIRED");
  }
  public static void requireMicrophone(boolean granted) {
    if (!granted) throw new Phone11CallRuntime.Failure("E_MICROPHONE_PERMISSION");
  }
  public static Map<String, Object> capabilities() {return capabilities(false);}
  public static Map<String, Object> capabilities(boolean consultation) {
    return Phone11CallRuntime.map("foregroundAudioTrial", true, "sdkVersion", "1.1.0",
      "sdkBuild", "20260905_1222", "trialCallLimitSeconds", 60, "backgroundCalling", false,
      "closedAppCalling", false, "wake", false, "transfer", false, "consultationSourceCandidate", consultation, "video", false);
  }
}
