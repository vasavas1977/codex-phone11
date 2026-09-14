# Recents playback and call actions

The requested design keeps recordings, summaries, and speaker-separated transcripts together in Recents. The supplied Zoom screens are interaction references; Phone11 retains its existing colors and navigation.

## User-visible behavior

- Recording playback defaults to the earpiece. A single Speaker toggle changes the output and returns to the earpiece when switched off. There is no separate Earpiece button.
- The timeline can be dragged or tapped, with elapsed and remaining time. The existing 15-second skip controls remain available.
- The call row offers an explicit callback and an ellipsis menu. Opening details or the menu never dials a number.
- Contact actions copy the number, open the native share sheet, star the contact/number, and use native contact editing where supported. Chat appears only for a uniquely matched teammate with an existing direct conversation.
- Summary tools copy the summary or transcript, share/export text through the system sheet, edit a personal copy, translate the existing content, create a private task, mark the call as billable, and save accuracy feedback.
- Secondary summary tools are collapsed behind one More summary actions entry, opening a compact bottom sheet. Playback and the Summary/Transcription tabs remain visible.
- Personal edits, tasks, billable flags, and feedback stay on this device under the signed-in account. They do not submit an invoice, create an external task, or overwrite the original AI output.
- Remove from Recents is a reversible device-local hide operation. Hidden calls can be restored. Cloud recordings are preserved.

## Integration boundaries

- Translation uses the configured Gemini service and owned recording IDs; credentials stay on the server. Supported choices are Thai, English, Simplified Chinese, Japanese, and Korean, with Original available to return to the source.
- This release does not integrate Google Docs, external task systems, or billing providers. Export opens the system share sheet with formatted text.
- Existing transcripts can be translated; this does not rerun speech recognition in a selected source language.
- Speaker 1/2 labels remain generic until the recording pipeline supplies a verified participant mapping. Contact names are not guessed from voices.
- Shared React Native presentation covers iOS and Android. Actual route switching, OS contact editors, and interruption behavior require separate handset verification. The current signed pilot is iOS/Siprix.
- The development preview uses synthetic data and makes no call or recording API requests. It is guarded by `__DEV__` and is not a production demo account.

## Acceptance still to record

Record signed build identity and installation separately from source tests. Physical acceptance must check earpiece default, Speaker on/off, drag seeking while playing/paused, headphones, and interruption by a real incoming call. Do not treat the web fixture as native audio evidence.
