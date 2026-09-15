# Recents design QA — 2026-09-15

Result: passed

Scope: rendered shared React Native Recents/player and menu design. This result is not proof of physical iPhone audio routing, Android audio routing, or live translation deployment.

## Reference and intent

Reference images supplied by the user: `/Users/vasavas16macbookpro/Downloads/IMG_0631.PNG`, `IMG_0632.PNG`, `IMG_0633.PNG`, `IMG_0634.PNG`, `IMG_0635.PNG`, and `IMG_0630 2.PNG`. Zoom is an interaction reference; Phone11 keeps its own colors and navigation. The latest explicit direction is a minimal design with default earpiece and one Speaker toggle.

Reference images were normalized from 1320×2868 to 440×956 for visual comparison. The real shared components were rendered with synthetic content at 440×956; a second 320×740 check verified no horizontal page overflow. Source and rendered player, summary, and menus were inspected at matching scale. Differences in text, OS status chrome, and product navigation are intentional.

## Corrections verified

1. Removed the redundant Earpiece button. Speaker is a single toggle alongside Play/Pause and skip controls.
2. Replaced seven always-visible summary tool buttons with one overflow entry.
3. Replaced a sparse full-screen icon grid with a scrollable bottom sheet with clear action rows.
4. Added web slider values and keyboard seeking; verified Home then ArrowRight gives 15 seconds. Drag seeking, Speaker state, summary/transcript switching, menu opening/closing, and transcript copy were exercised in the preview.
5. Reduced player spacing to fit a 320-pixel phone without horizontal overflow. Text wraps vertically and scrolling remains available.

No remaining blocking visual or interaction finding in this reviewed scope. Native routing and system sheets require handset acceptance separately.

## Icon refinement

The user requested an even simpler player after reviewing the first preview.
Play/Pause now uses a triangle/pause icon; double-arrow icons retain the same
15-second skip behavior. Speaker keeps one short label, an outlined off state,
and a blue selected state. Accessible labels explain the skip interval and
output action. The loading state uses a spinner.

Verified the updated shared component at 320×740 and 440×956 with no horizontal
overflow. Preview interactions confirmed forward/back 15 seconds, play/pause,
and Speaker on/off. All touch targets remain at least 44 points. The preview
uses synthetic state and does not establish physical audio routing.

## Output picker refinement

The user's latest reference (`IMG_0636.PNG`) supersedes the direct Speaker
toggle: the same compact Speaker button now opens an output picker. iOS embeds
the public AVRoutePickerView, leaving device discovery and selection to iOS.
The browser preview uses a compact fallback sheet with Phone and Speaker,
icons, and a checkmark on the selected output. It never fabricates Bluetooth
devices. Android can supply its actual route inventory and selection adapter.

Verified the fallback at 320×740 and 440×956: no horizontal overflow, tapping
Speaker opens the sheet, choosing an output updates the checkmark and closes
the sheet. Native output selection is a separate physical-handset gate; browser
screenshots establish the fallback design only.

## Evidence

- `docs/phone11-daily-use/recents-design-qa-20260915/minimal-player.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/minimal-summary-menu.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/minimal-call-menu.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/minimal-small-phone.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/icon-player.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/icon-player-small.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/icon-player-speaker.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/output-picker.png`
- `docs/phone11-daily-use/recents-design-qa-20260915/output-picker-small.png`

Preview: `http://127.0.0.1:8087/dev/recents-preview`. It is development-only and uses synthetic content, with no actual call or recording API requests.

## Recents completion verification — 2026-09-15

Result: passed

The completed menu and playback work was compared again with the supplied Zoom
Phone call-action, audio-output, summary-action, and named-transcript
references. The review used an 851×938 browser viewport; the 1320×2868 phone
references were normalized to the same height in the side-by-side evidence.

Verified interactions:

- Dragged the recording slider from 0:00 to 1:50; the remaining time changed to
  1:46.
- Toggled Play to Pause and back.
- Opened the output sheet and verified Phone and Speaker. Native Bluetooth
  devices appear only when iOS reports an available route; the browser fixture
  correctly does not fabricate one.
- Opened the call sheet and verified Call, Call details, Copy number, Share call
  details, Star, and reversible Remove from Recents. Removing history preserves
  the cloud recording.
- Opened Summary actions and verified Copy, Share, Export, Edit personal
  summary, Translate, Save task, and feedback controls. Translation is disabled
  in this fixture because it has no translation-service callback.
- Switched to Transcription and verified the visible names are Vasavas and
  Nathasa rather than Speaker 1 and Speaker 2.
- Confirmed no browser console errors. Development-only React Native Web and
  Expo warnings remain.

Automated verification: 9 focused files and 71 tests passed. Targeted ESLint
completed with zero errors, and `git diff --check` passed.

No P0, P1, or P2 issue remains in the shared UI scope. The web preview cannot
prove a physical Bluetooth route or native iOS share sheet; those remain
handset acceptance checks.

Additional evidence:

- `design-qa-evidence/recents-controls-final.png`
- `design-qa-evidence/call-actions-final.png`
- `design-qa-evidence/summary-actions-final.png`
- `design-qa-evidence/audio-output-final.png`
- `design-qa-evidence/transcription-names-final.png`
- `design-qa-evidence/call-actions-comparison.png`
- `design-qa-evidence/summary-actions-comparison.png`
- `design-qa-evidence/audio-output-comparison.png`

## Preview visibility follow-up — 2026-09-15

The development fixture now exposes the completed controls directly at the
same URL: `http://127.0.0.1:8087/dev/recents-preview`. It visibly includes
name/number search, Recorded and AI summary filters, Share recording, and a
Bluetooth headset row in the fallback output picker. The fixture remains a
phone-width responsive surface inside a desktop browser; the production
desktop dial pad is a separate route and keeps its own layout.

The Android background push enrollment permission regression was also fixed in
`4865442` by removing row locks from read-only assignment tables while keeping
locks on service-owned push, wake, and auth-session rows. Focused push tests
pass.
