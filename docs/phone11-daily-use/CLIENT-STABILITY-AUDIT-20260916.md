# Phone11 client-stability audit — 16 September 2026

## Scope and evidence boundary

This is a static source audit of the iOS Siprix/CallKit client and the React
Native paths most likely to change while a call is live: call navigation,
recording controls, translation, playback, and audio routing. It is **not** a
device-crash investigation. No iOS crash log, MetricKit report, or handset
reproduction was available, so it cannot identify the process that closed the
app or claim a device fix.

Focused CallKit tests cover the source change in this audit. Native device
acceptance remains required before a release.

## Fix included

`NativeCallManager` created its SIP-call-to-CallKit UUID mapping before asking
CallKit to display an incoming call or report an outgoing call. If CallKit
rejected that synchronous transaction, the mapping remained. A retry for the
same SIP call then returned early as if the call were already represented by
CallKit. This can leave the call lifecycle out of sync, and makes later native
actions harder to reason about.

The mapping is now removed when either native transaction throws. The retry is
therefore safe and remains subject to the normal CallKit/SDK state checks.
Regression tests cover rejected incoming presentation and rejected outgoing
reporting followed by a retry.

## Highest-risk areas still requiring real-device evidence

1. **Native process termination versus JavaScript navigation.** `SipProvider`
   tears down CallKeep and Siprix when the root provider unmounts. In a
   production build that should only happen when the application is exiting,
   but a real unexpected close must be classified from an iOS `.ips` crash or
   MetricKit diagnostic before changing this lifecycle. Do not infer a native
   crash from a returned sign-in screen or a lost connection.
2. **CallKit/Siprix audio-session ordering.** `Phone11Siprix` serializes bridge
   methods and sends SDK delegate events to the main queue; CallKeep audio
   activation is also forwarded through the same runtime. Test the order on a
   handset during answer, mute, hold, speaker, Bluetooth route change,
   background/foreground, and end. The source tests only prove command and
   state handling, not microphone or audible media.
3. **Recording finalization polling.** Active-call recording checks every five
   seconds and, after an accepted stop, may poll every two seconds for two
   minutes while the app is active. This is bounded and cleans up on unmount,
   but it needs a server-backed test under poor network conditions so it does
   not make the active-call screen feel stalled.
4. **Playback/active-call audio ownership.** Playback refuses to run during a
   live call and clears an applied playback route when a call arrives. Verify
   that this reset does not take CallKit's audio session from a newly answered
   call, especially with Bluetooth connected.
5. **Translation failure handling.** A translation request is generation-bound
   and the UI consumes the rejection. Confirm with a deliberately unavailable
   service that the sheet remains usable, shows one bounded error, and can be
   dismissed or retried without remounting the call-history screen.

## Handset reproduction matrix

Capture the Phone11 build number, iOS version, connection type, and the exact
time for every result. If the app closes, attach the corresponding device
Analytics/Crash report before retrying.

| Scenario | Expected safe result |
| --- | --- |
| Answer a normal incoming call, mute/unmute, hold/resume, hang up | Call UI changes without closing; audio state matches the other party |
| Incoming call while locked, then answer and minimize to Recents | The system call remains connected and Phone11 can return to the active call |
| Start then stop recording on a completed correlated call | One control state advances to finalizing, then the completed recording appears after the call |
| Start recording with delayed/no server response | Phone11 shows an actionable status; it remains responsive and never invents a completed recording |
| Open a recording, change speaker/Bluetooth route, then receive a call | Playback pauses and the call owns audio; Phone11 remains open |
| Translate a summary while toggling back to original and navigating away | The selected request may finish or be discarded, but no stale result replaces another call |
| Cellular-to-Wi-Fi and Wi-Fi-to-cellular during an active call | The client may reconnect or report a bounded call failure; it must not terminate the application |

## Next diagnostic needed for any remaining close

Obtain the timestamped iOS crash/termination report and the Phone11 in-app SIP
diagnostics export from the same attempt. The report must distinguish
`jetsam`, watchdog, native exception, JavaScript reload, CallKit provider
reset, and voluntary app termination. Redact phone numbers, tokens, and SIP
credentials before sharing it with engineering.
