# Phone11 desktop visual verification — 2026-09-27

final result: passed

Previous mobile report preserved in [Recents QA](docs/design-qa/recents-20260915.md).

## Target and evidence

- Source visual truth: `/tmp/phone11-premium-qa/zoom-reference.png`, captured from the user-authorized Zoom Workplace desktop Phone screen. Contains private contact rows; retained locally, not copied into product data or committed.
- Implementation: `/tmp/phone11-premium-qa/implementation-final.png` from the actual built HTML/CSS/renderer with an isolated synthetic adapter outside the repository and package. DESIGN PREVIEW is shown in its chrome. No live calls were made by this adapter.
- Source and implementation: 1024 × 768 pixels, matching 1024 × 768 CSS viewport, no density resampling.
- Full comparison: `/tmp/phone11-premium-qa/comparison-final.png`, 2048 × 768, source left and implementation right.
- Focused dialpad comparison: `/tmp/phone11-premium-qa/dialpad-comparison-v2.png`. Key dimensions, labels, control hierarchy and typography were inspected together.
- Additional states: `held-call.png`, `voicemail.png`, `narrow-final.png` in the same local evidence directory. Narrow test used 360 × 700 CSS pixels; vertical scrolling is intentional, no horizontal overflow.

## Comparison history

1. Initial implementation: `/tmp/phone11-premium-qa/comparison-v1.png`.
   - P1: large ready-to-call heading and outlined 56px keys drifted from Zoom's quiet status and 46px filled keys.
   - P2: underlined tabs and duplicate rail brand changed the reference hierarchy.
   - Fixed: top status strip, 46px pale keys and blue call control, centered field, segmented tabs, and simpler rail.
2. Revised implementation: `comparison-v2.png` and focused dialpad comparison.
   - Desktop proportions matched the selected reference structure. Intentional differences listed below.
   - P2 narrow state: voicemail content overlapped the trial footer.
   - Fixed: constrained independently scrolling list panel and nonshrinking footer; 280px narrow list region. Verified `panelContent=165`, `panelHeight=153`, `scrollWidth=360` at 360px viewport.
3. Final combined comparison: `comparison-final.png`; narrow evidence: `narrow-final.png`.
   - No remaining actionable P0/P1/P2 visual findings for this scope.
   - Minor final correction removed the inherited narrow extension-label width cap and made the End icon white; checked in the final browser rerender.

## Required fidelity surfaces

- Typography: local macOS system fonts, compact 11px tabs/status, 16px section title and 21px keypad digits. No remotely loaded fonts. Thai fallbacks retained.
- Spacing: 42px top strip, 68px rail, 288px list pane, persistent sibling dialpad. Circular 46px keys with 15px gaps. Desktop list scrolls independently.
- Color: white content, cool grey chrome and keys, subtle dividers, Phone11 blue active/call controls; red only for ending a call or errors.
- Assets: pinned Lucide 1.48.0 icons and license bundled locally. No copied Zoom artwork, profile photos, or fabricated customer data.
- Copy: Phone11 branding, real assigned extension, honest unavailable-history/playback labels and 60-second trial notice. No backend/provider identifiers exposed as call titles.

## Intentional differences and limits

Zoom has more licensed modules and populated call history. Phone11 currently exposes Phone and Meetings only; adding inert navigation or synthetic history would misrepresent functionality. History remains unavailable, voicemail playback remains unavailable, and voicemail API deployment is separate from this visual package. The selected visual target has a name search, while Phone11 supports number/extension dialing. Icon silhouettes and brand treatment remain Phone11's. This visual acceptance does not establish full Zoom feature parity.

## Interaction validation

The built renderer was exercised in the isolated preview: nested keypad letter taps, backspace, external form-associated Call, connected/muted/held/resumed/ended states, voicemail loading, Lines, Meetings and responsive scrolling. Console check returned no warnings/errors. Independent read-only review caught the removed destination pattern; it was restored before packaging. Desktop automated tests and typecheck are run separately. Live SIP/audio and signed-in native acceptance are not established by preview tests.
