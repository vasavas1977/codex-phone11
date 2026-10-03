# Phone11 call prompts

`recording-ai-notice-en-male.wav` is the recording-consent announcement:

> This conversation will be recorded with AI.

It uses the macOS Daniel English male voice at 178 words per minute, normalized
for telephone playback. The deployed WAV must remain mono, 8 kHz, signed
16-bit PCM and under four seconds so both callers hear the complete notice
before capture begins.

The current live deployment retains the older compatibility filename
`recording-ai-notice-th.wav` in its private shared prompt volume. Deploy this
asset over that exact file until the private backend environment is migrated to
the source filename; changing only the environment path requires recreating the
backend container and is not necessary for this prompt update.
