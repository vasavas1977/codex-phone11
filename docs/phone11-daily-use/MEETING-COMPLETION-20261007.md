# Meeting prejoin focus lifetime — 7 October 2026

The prejoin route previously retired pending joins on Back and unmount, but a
stack navigation can blur a route while retaining its component. A delayed
admission or connection could then complete and reopen the meeting screen. A
boolean focus guard alone would revive that attempt if the user returned before
it completed.

`app/conference/index.tsx` now owns a distinct focus lifetime. Back and focus
cleanup retire it; every asynchronous milestone checks the initiating lifetime.
A late connected lifecycle leaves its exact room before returning the fixed
`post_connect_guard` failure. Failed room cleanup retains the existing
`room_cleanup` behavior and controller custody. A new Join after refocus requests
fresh admission and works normally.

The regression against the unchanged `b54ae07` route failed because the old
pending web direct admission resolved instead of rejecting. The fixed focused
suite passed 74 tests, including 12 new web/iOS/Android × direct/channel cases
covering delayed admission and connection after blur and refocus. Existing Back,
unmount, account replacement, current-owner, exact invited room and SIP refusal
coverage remained passing.

The expanded six-file invitation/prejoin suite passed 180 tests: direct meeting
action, channel picker, channel creation, prejoin UI, authentication races and
owner/focus lifetime. Targeted ESLint and `git diff --check` passed. Tooling emits
the existing Vite CJS API and ESLint package module-type notices.

This is source-level cancellation evidence using mocked admission and media. It
does not establish released web/native packages, provider behavior, invitation
delivery, physical microphone/camera cleanup or two-device audio/video acceptance.
Those remain independent release and runtime gates.
