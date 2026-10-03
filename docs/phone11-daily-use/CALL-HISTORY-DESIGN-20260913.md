# Phone11 call history design

Implemented from the supplied Zoom reference screens, keeping Phone11's own visual styling.

## Interaction

- Compact history rows grouped by date, with All and Missed filters.
- Tapping a row reveals one inline detail panel. The separate Call button places a callback.
- Recording and AI indicators appear only for actual server statuses. Local/server records join only by authoritative native history ID; unmatched server entries retain their own identity.
- Playback appears above Summary / Transcription tabs, with elapsed time, duration, play/pause and 15-second skipping.
- Summary previews contain Quick recap and Next steps. Full summary and full transcription open a readable detail screen with Back navigation.
- Transcript text stays faithful to the available plain-text server format; there are no invented speakers or timestamps.
- Light/dark colors, Thai wrapping, accessible labels and at least 48-point controls are supported.
- Admin recording policy is a separate settings screen. Unsupported sharing, editing, rating and deletion controls are omitted.

## Validation and release boundary

The web preview imports the actual presentational React Native components, rendered with React Native Web and clearly labeled illustrative content. It is a design preview, not live cloud audio. Native integration retains authenticated playback, account isolation, incoming-call guards and navigation cleanup.

The source candidate does not establish live cloud recording readiness. Server configuration, migration, announced capture on a real call, Gemini access and handset playback still require commissioning. The installed handset build does not yet contain this redesign.
