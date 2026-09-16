# Recents player crash investigation

16 September 2026. Affected signed iPhone build: 62, source `2baf026`.

The owner reproduced an app exit when opening AI from call history. Device
crash reports at 18:21 and 19:32 show SIGABRT on the React Native exceptions
queue. The device system-log archive identifies the error:

```text
FunctionCallException: Calling the 'pause' function has failed
NativeSharedObjectNotFoundException: Unable to find the native shared object
associated with given JavaScript object
at Playback
```

Expo Audio uses `useReleasingSharedObject`, whose effect releases the native
player on unmount. Phone11's later focus cleanup called `player.pause()`
without handling an already-released object. This exception also interrupted
the remaining subscription and playback-session cleanup.

The fix makes cleanup tolerate released native players, revokes authorization
before clearing the source, and handles synchronous seek failures. Ordinary
playback failures must remain visible rather than being silently accepted.
Regression tests exercise the native-release-before-cleanup order.

A separate defensive change rejects malformed summary payloads before naming
participants. This was a crash-capable validation gap, but was not the error
identified in this incident.

Raw device logs remain local; they are not committed. Passing source tests and
signed-package checks do not establish handset acceptance. Repeating the same
Recents action on the replacement build remains the final check.
