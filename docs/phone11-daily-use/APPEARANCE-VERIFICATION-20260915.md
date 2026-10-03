# Phone11 appearance verification — 2026-09-15

Implemented System (default), Light and Dark choices in Settings with saved preference. Active call stays on a dark stage. The development Recents fixture uses the same appearance state and has an explicitly labeled preview selector.

Verified the real Phone11 web route `/dev/recents-preview` at 390 × 844 in Chrome through browser automation: both appearance buttons change rendered colors, with no page errors. Inspected both captured images. Additional browser checks verified saved Dark appearance survives reload and System changes with light/dark device media after hydration. This proves the mobile web preview only; it does not prove iPhone installation, native appearance, desktop-specific layout, camera, or calling.

Focused tests: 4 appearance behavior tests, 9 active recording UI tests, 21 recording UI tests pass. Baseline before transfer edits: 136 current-call, Siprix and CallKit tests pass.

Repository-wide TypeScript check has pre-existing errors in the marketing site, missing legacy transfer types, recording-share Blob typing, and Node URL types in tests. Do not report the whole project as type-clean.

New native automatic appearance configuration needs a new signed build. Existing Build54 QR does not contain these changes. No device installation performed in this verification.

Standing UX requirement: mobile and desktop must have independently considered layouts and be tested against clear UC workflows; a centered phone preview is not a completed desktop UX.
