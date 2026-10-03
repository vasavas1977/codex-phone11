# Verified speaker identity for recorded calls

**Status:** Implementation pending. Inbound and outbound physical proof pending.

## Safe current behavior

Phone11 accepts AI transcripts only when every nonempty line begins exactly `Speaker 1:` or `Speaker 2:`. These are safe generic voice labels. They show that Gemini distinguished turns; they do not prove which voice belongs to the Phone11 user or the remote caller.

Contact names, caller IDs, call direction, and the authenticated account may describe the two participants, but they do not bind a generic Gemini label to either participant. Until that binding is supported by capture-channel evidence, Recents must display `Speaker 1` and `Speaker 2`. It must not substitute participant names based only on inbound or outbound direction.

Existing recordings must not be relabeled with names unless their stored media and capture metadata independently prove the mapping. If an old recording is mono or was downmixed, its speaker identity cannot be recovered safely; keep its generic labels.

## Why the current recording is insufficient

Phone11 enables `RECORD_STEREO` on one exact FreeSWITCH channel before running `uuid_record`. FreeSWITCH documents the resulting stereo WAV as the tapped session's read stream in channel 1 and write stream in channel 2; its channel-variable catalog also describes A-leg audio on the left and B-leg audio on the right. `RECORD_STEREO_SWAP` reverses the channels.

The current correlation path identifies a FreeSWITCH channel UUID, but it does not persist evidence that proves whether that tapped channel and its read/write streams belong to the local Phone11 participant or the remote participant. Route direction alone is not enough to resolve that relationship for every bridge.

Gemini's general audio input also combines multichannel audio into a single channel. Sending the stereo WAV through the current generic audio-analysis request therefore loses the channel boundary before speaker labels are generated.

## Required implementation contract

1. Parse the stored RIFF/WAVE file locally. Accept only bounded PCM format 1, two channels, 16-bit samples, the expected 16 kHz sample rate, valid RIFF chunk boundaries, and frame-aligned audio. Handle harmless additional RIFF chunks. Reject mono, malformed, unsupported, misaligned, or oversized input instead of guessing.
2. Split the interleaved stereo samples into two valid mono WAV buffers before any provider upload.
3. At the exact FreeSWITCH bind and recording start, collect the tapped UUID and trusted channel-relationship variables, including available `originator`, `originate_signal_bond`, and `signal_bond` evidence. Persist a versioned channel map only when these values resolve the two channels unambiguously. Do not infer participant roles from call direction alone.
4. Send each mono channel separately to Gemini's transcription API with word timestamps. Validate finite, monotonic offsets and bounded text. Preserve Thai and English verbatim.
5. Group timestamped words into turns for each channel and merge both streams by start time with a deterministic tie rule. Emit the existing strict transcript format: one nonempty `Speaker 1:` or `Speaker 2:` turn per line.
6. Run the existing summary stage over the merged transcript. Publish the analysis atomically only after both channel transcriptions and the summary validate. Clean up both provider files on success and failure.
7. Keep the existing transcript text and summary JSON storage shapes. Add small, versioned speaker-role metadata, such as `{ speaker1Role, speaker2Role, verified, evidenceVersion }`. Return participant names to the UI only when this mapping is verified. Otherwise, return generic labels.

## Required verification

Automated coverage must include exact sample deinterleaving, additional RIFF chunks, malformed and unsupported input, ambiguous FreeSWITCH relationships, inbound and outbound relationship fixtures, two separate provider requests, timestamp ordering and ties, one silent channel, Thai and English preservation, cleanup, retries, atomic publication, owner isolation, and generic UI fallback when verification metadata is absent.

Physical acceptance requires two supervised calls with distinct spoken phrases:

- An inbound PSTN-to-Phone11 call.
- An outbound Phone11-to-PSTN call.

For each call, inspect the two stored WAV channels independently and verify which phrase appears on each channel. Compare that result with the captured FreeSWITCH relationship variables. Only after both directions agree may the application mark the mapping verified and replace generic labels with the contact or account names.

## Primary documentation

- [FreeSWITCH audio files and `uuid_record`](https://developer.signalwire.com/freeswitch/media-and-codecs/audio-files/)
- [FreeSWITCH channel variables, including `RECORD_STEREO`](https://developer.signalwire.com/freeswitch/reference/channel-variables/)
- [Gemini audio understanding: multichannel input is combined](https://ai.google.dev/gemini-api/docs/audio)
- [Gemini audio transcription and timestamp annotations](https://ai.google.dev/gemini-api/docs/transcribe)

