package expo.modules.audio;

final class AndroidPlaybackRouteStateTest {
  private static int checks;
  private static void check(boolean value) { ++checks; if (!value) throw new AssertionError("check " + checks); }
  public static void main(String[] args) {
    PlaybackRouteState state = new PlaybackRouteState();
    check(state.autoResume(true));
    check(!state.autoResume(false));
    check(state.select("earpiece", .7f) == 0f);
    check(state.waiting());
    check(!state.autoResume(true));
    // Controller volume=1 and muted=false must not bypass priming.
    check(state.changeVolume(1f) == 0f);
    check(state.observe("unknown", 0f) == 0f);
    check(state.observe("speaker", 0f) == 0f);
    check(state.rejected("speaker"));
    check(state.waiting());
    check(!state.rejected("external"));
    check(state.observe("earpiece", 0f) == 1f);
    check(!state.waiting());
    // Pausing loses a valid actual route, so every resume primes muted again.
    check(state.observe("unknown", .8f) == 0f);
    check(state.waiting());
    check(state.changeVolume(.4f) == 0f);
    check(state.observe("external", 0f) == .4f);
    check(!state.waiting());
    // Removing an accessory cannot leave requested receiver audio audible on speaker.
    check(state.observe("speaker", .4f) == 0f);
    check(state.rejected("speaker"));
    check(state.changeVolume(0f) == 0f);
    check(state.observe("earpiece", 0f) == 0f);
    check(state.select("earpiece", .6f) == 0f);
    int stale = state.epoch();
    check(state.select("speaker", 0f) == .6f);
    check(state.epoch() != stale);
    check(!state.waiting());
    check(state.observe("speaker", .6f) == .6f);
    check(!state.rejected("speaker"));
    check(!state.autoResume(true));
    check(state.select("system", .5f) == .5f);
    check(!state.autoResume(true));
    check(state.select("earpiece", .9f) == 0f);
    int oldTrack = state.replacingTrack();
    check(state.observe("earpiece", 0f, oldTrack) == .9f);
    check(!state.waiting());
    int replacement = state.replacingTrack();
    check(state.waiting());
    check(state.effectiveVolume(1f) == 0f);
    check(state.observe("earpiece", 1f, oldTrack) == 0f);
    check(state.waiting());
    check(state.effectiveVolume(1f) == 0f);
    check(state.observe("external", 0f, replacement) == .9f);
    check(!state.waiting());
    check(state.effectiveVolume(.9f) == .9f);
    state.close();
    check(state.released());
    check(!state.autoResume(true));
    check(!state.waiting());
    check(!state.rejected("speaker"));
    boolean rejected = false;
    try { state.select("earpiece", 1f); } catch (IllegalStateException expected) { rejected = true; }
    check(rejected);
    PlaybackRouteState other = new PlaybackRouteState();
    check(other.autoResume(true));
    check(other.select("speaker", 1f) == 1f);
    check(!other.autoResume(true));
    check(other.changeVolume(.3f) == .3f);
    System.out.println("PASS " + checks + " Android per-player route state assertions");
  }
}
