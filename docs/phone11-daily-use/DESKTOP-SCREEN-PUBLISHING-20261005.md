# Desktop screen publishing source candidate

Base: `36cc3d207f2cabeed4a2c73a97dc6394a4a8fdbb`. This change supplies desktop
video-only publishing in the existing isolated Electron meeting window. It is
source work pending independent review, CI, packaged application validation,
OS consent and observed screen delivery. It does not establish those results.

Share appears only for interactive admission and a connected SDK participant
whose actual publishing permissions allow ScreenShare. It invokes capture
directly from the click, before awaiting IPC or queued media work. A cancellable
chooser lists screen/window names; it does not select a source automatically.
Screen audio is off. Existing camera, microphone, chat and screen receiving
remain on the same Room.

Main separately guards display-capture and the actual display request frame:
exact owned WebContents/main frame/local meeting URL, current authenticated
session object and revision, interactive admission and room scope, SDK
availability from the trusted preload, active user gesture, video requested,
audio absent, no SIP ownership and no closure. The admission token expiry is
not used as a new lifetime limit for an established room.

`MeetingScreenPicker` retains native source objects in main. The UI receives
single-use opaque choice handles and bounded names. Enumeration requests zero
thumbnails and no icons, then selection re-enumerates and rechecks authority.
Cancellation, navigation, sign-out/closure, SDK revocation and SIP takeover
retire pending selections. `useSystemPicker` is false so it cannot bypass the
custom display handler. See the [Electron capture API](https://www.electronjs.org/docs/latest/api/desktop-capturer).

`DesktopMeetingScreenShare` owns pending capture/publication and live tracks.
Stop invalidates pending work and stops owned tracks synchronously. Late tracks
are stopped rather than published; late or stale publications are retired.
Failed stop/unpublish remains owned with visible Stop retry guidance. Reconnect
and permission revocation stop sharing without restarting it. A provider room
move retires the screen owner and requests window closure/re-admission.
Leave drains the screen owner before disconnect; main retains its existing
bounded two-second window-destruction fallback before releasing SIP/account
handoff.

Offline tests exercise the actual main handlers and bundled preload with
synthetic Electron/SDK/DOM boundaries, plus picker and track-owner failure and
race cases. No test invokes real desktopCapturer/getDisplayMedia, launches the
app, obtains a provider token or accesses customer data. Source tests cannot
prove Chromium gesture propagation, OS screen-recording consent, packaging or
remote screen delivery. No native mobile publishing or recording/caption/host
operation capability is added.

Author checks: all desktop offline tests passed (198 passed, one explicitly
disabled opt-in Chromium history test); the 34 new screen tests execute without
skips. Desktop TypeScript,
scoped ESLint and in-memory main/preload source bundles passed. ESLint reports
the existing root package module-type warning. No package/signing build or
application launch was run.
