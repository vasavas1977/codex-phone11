# Bounded synthetic Android media probe

Status: helper compiles against the pinned Siprix AAR; detector self-tests pass. Actual SDK capture, waveform transmission, received media, and channel mapping remain unverified until a run exports real files. No microphone or speaker acceptance is claimed.

The pinned AAR was inspected with `javap`. It exposes `callPlayTone(int,String,int,IdOutArg)`, `callRecordFile(int,String)`, `callStopRecordFile(int)`, and `IniData.setRecordStereo(boolean)`. Siprix documents tone generation into a connected call and recording sent/received media separately when stereo is enabled. See the [official API reference](https://docs.siprix-voip.com/rst/api.html). No undocumented SDK methods are used.

## Implemented native integration

`Phone11SiprixModule` enables `ini.setRecordStereo(true)` before SDK initialization. Its `Runtime.media()` lazily creates one `LabMedia` helper for the existing `SiprixCore` and first checks that the core is initialized. The constructor is `LabMedia(Context, SiprixCore, Handler, Runnable stateChanged, Runnable teardown)`. Both callbacks execute on the existing main/SDK queue. The integrated state callback emits a `labMedia` native event; the teardown callback invokes `Runtime.destroy()`, shared with the public destroy method. All methods execute through the existing main-thread queue. `LabMedia.Failure` is returned as its safe error code with the message “Synthetic lab media operation failed”.

The implemented lab methods are:

| Native method | Behavior |
| --- | --- |
| `labStartMedia(callId)` | Validates an owned current call in `connected` state, then starts fixed-file capture with the runtime generation. |
| `labInjectTone(callId)` | Validates the same connected call and injects the one permitted three-second tone. |
| `labStopMedia()` | Requests stop and returns current media metadata. |
| `labClearMedia()` | Deletes only the fixed capture after the helper is no longer active or playing; returns cleared metadata. |
| `getSnapshot()` | Includes `labMedia`, or `null` before the helper exists. There is no separate media-status method. |

The existing generation-filtered `onCallTerminated` callback forwards the call ID and generation to the helper before removing the call. The generation-filtered `onPlayerState` callback forwards player state to the helper.

Destroy calls `core.unInitialize()` first. Only after successful uninitialization does it call `media.onCoreDestroyed()`, detach the model listener, mark the runtime uninitialized, increment its generation, and clear call/account/pending-command state. It does not separately invoke media stop before uninitializing. The helper cancels its deadline and labels any capture active during teardown `core_destroyed_unverified`; that state does not prove a playable finalized file.

The helper checks `ai.phone11.mobile.lab`, accepts no arbitrary filename or tone, and never requests microphone permission. Existing bridge restrictions allow only the fixed synthetic account and destinations. Keep host microphone input disabled in the dedicated emulator. SDK call setup may independently require the existing Android app permission; this helper grants none.

Recording stop is requested after 20 seconds on the main handler. If SDK stop fails or throws, the helper requests hangup of the same synthetic call and retains a safe failure code. Whether BYE fails or merely returns accepted, a second timer waits at most two additional seconds for a real termination callback; if the same capture remains active, it invokes the actual runtime teardown. Matching call termination, a successful manual stop, or successful core destruction cancels both timers. A teardown failure stays visibly active with `teardown_failed`; successful forced teardown remains `core_destroyed_unverified`, never finalized media proof. The PBX's independent absolute 20-second call limit remains a separate bound. Timer scheduling is not a hard real-time guarantee.

## Implemented lab-screen controls

The screen uses its existing command wrapper and native snapshot refresh. The exact control labels and methods are:

| Visible control | Bridge method |
| --- | --- |
| **Capture media** | `labStartMedia(call.callId)` |
| **Inject tone** | `labInjectTone(call.callId)` |
| **Stop capture** | `labStopMedia()` |
| **Clear media** | `labClearMedia()` |

The accessibility `lab-state` JSON includes the snapshot's `labMedia` object (status, active flag, fixed path, bytes, elapsed time, tone status, stop reason, safe error code, and `verified: false`). There is no **Media status** button or separate React media-state variable. Accepted record/tone commands are not PASS results.

Player callbacks, watchdog changes, matching termination, and core destruction notify the integrated `stateChanged` callback. Its `labMedia` event reaches the screen's existing generic native-event listener and triggers a snapshot refresh, so asynchronous media state is observable without a separate status button. Failure to emit to a detached JavaScript instance does not interrupt the watchdog or runtime teardown.

## Runtime capture sequence

1. Use the registered synthetic 7101 and PBX tone destination 7190. Start media only after the real connected callback. Record at least one second of the PBX's 440 Hz tone before injecting the fixed three-second DTMF-1 audio waveform (697 + 1209 Hz).
2. Independently capture the same call's PBX receive leg. The fixture agent verified Asterisk `mixmonitor start/stop` availability. Require exactly one owned `PJSIP/7101-<hex>` channel in `Up` state. With a generated safe run prefix, use the CLI command below inside the owned container; do not use the `b` option because the tone application is not a bridged two-endpoint call.

   ```text
   mixmonitor start PJSIP/7101-<validated-hex> /tmp/<controlled-run>-mix.wav,r(/tmp/<controlled-run>-rx.wav)t(/tmp/<controlled-run>-tx.wav)
   mixmonitor stop PJSIP/7101-<validated-hex>
   ```

   The `r` file is audio received by Asterisk from 7101, providing independent uplink evidence. Copy only these generated run files and delete only those exact temporary paths after export. The CLI start/stop syntax and generated files still need validation on the actual run.
3. Press **Stop capture**, wait for nonzero stable file size, and export the fixed app-scoped file from the selected lab emulator:

   ```text
   /sdcard/Android/data/ai.phone11.mobile.lab/files/lab-media/siprix-duplex.mp3
   ```

   The app-specific external directory is isolated from ordinary other apps by Android scoped storage; privileged ADB/operator access remains possible. Do not export customer recordings or arbitrary paths.
4. Analyze decoded samples and save the JSON evidence privately:

   ```sh
   python3 lab/android/media-analyze.py .lab/<run>/siprix-duplex.mp3 --peer-received .lab/<run>/pbx-rx.wav
   ```

   MP3 input requires local FFmpeg. WAV input uses Python's standard library. The decoder permits file/pipe protocols only and caps duration and size. The detector finds 440, 697, and 1209 Hz in short windows, rejects silence, and identifies channel direction from the actual signature distribution. It never assumes left/right ordering. If signatures overlap or mapping is ambiguous, the result stays incomplete.
5. Preserve hashes and source/build identity alongside both captures. Use **Clear media** to remove the app's fixed file only after export. The core must remain initialized (or be initialized again) because the bridge gates clear through `Runtime.media()`. A second recording intentionally fails until the previous file is explicitly cleared.

A local sent-channel recording alone does not prove audio reached the peer. Without the independent PBX receive file, `independentPeerUplinkDtmf1` remains `NOT_PROVEN`. Even with both media checks passing, actual handset microphone capture, receiver/speaker audibility, Bluetooth, and background audio remain separate gates.

## Offline verification performed

```sh
javac -cp /tmp/phone11-aar-api/classes.jar:$ANDROID_HOME/platforms/android-35/android.jar -d /tmp/phone11-media-java modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/LabMedia.java
python3 lab/android/media-analyze.py --self-test
```

The detector self-test generates normal and swapped stereo signatures, an independent mono peer signal, silence, and absent-peer cases. These tests validate the detector; they provide no actual Siprix media evidence.

## Watchdog lifecycle regression checks

`lab/android/java-tests/MediaLifecycleTest.java` compiles the actual helper against small Android/SDK stubs. Six scenarios verify both stop and BYE failure without a termination callback, accepted BYE without termination, cancellation by real termination, stale/current player callback handling and notification, successful manual stop, failed runtime teardown, and exception handling. Original safe failure codes remain visible and forced teardown never claims finalized media.

```sh
javac -d /tmp/phone11-media-lifecycle lab/android/java-tests/stubs/android/content/Context.java lab/android/java-tests/stubs/android/os/*.java lab/android/java-tests/stubs/com/siprix/SiprixCore.java modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/LabMedia.java lab/android/java-tests/MediaLifecycleTest.java
java -cp /tmp/phone11-media-lifecycle ai.phone11.siprix.MediaLifecycleTest
```

These JVM checks exercise watchdog decisions and callback handling. Native runtime/media verification remains pending.
