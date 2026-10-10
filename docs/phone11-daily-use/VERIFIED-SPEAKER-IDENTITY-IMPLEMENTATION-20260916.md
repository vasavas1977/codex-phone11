# Verified speaker identity implementation slice

**Status: source contract only — not commissioned.** Phone11 continues to show
`Speaker 1` and `Speaker 2` until a recording carries the versioned evidence
below. This change does not alter active recording, FreeSWITCH, Gemini, or a
customer transcript.

## What is now stored and returned

`phone11_cloud_recordings.speaker_identity` is a small JSON record. The server
accepts it only when all of these facts agree:

- `captureChannelUuid` is the exact anchored Phone11 extension channel that
  owns the recording.
- `extensionChannelUuid` equals that capture UUID.
- `signalBondUuid` and `peerChannelUuid` are the same, different valid UUID.
- Left and right recorded channels are assigned to different roles:
  `extension` and `remote`.
- `recordStereoSwap` is retained and applied before `speaker1Role` and
  `speaker2Role` are returned.

The mobile API returns only the non-identifying role map. The phone combines
it with the signed-in extension name and its private contact label locally.
That preserves contact privacy and makes no direction, caller-ID, or account
name inference on the server.

## Collector required before enabling names

The capture service must add an authenticated, transactional collector at the
same point it starts `uuid_record`:

1. Read an authenticated JSON channel snapshot for the anchored extension
   channel and its `signal_bond` peer.
2. Persist exact UUIDs, `RECORD_STEREO_SWAP`, and the observed left/right role
   assignment with the capture token. It must reject missing, rewritten,
   self-bonded, or conflicting relationships.
3. On record stop, atomically copy the validated record to
   `speaker_identity` only for the same capture token, recording path, tenant,
   and extension. A later retry must not replace a completed record.
4. Split the stereo WAV and transcribe both channels separately before issuing
   the generic `Speaker 1` / `Speaker 2` transcript. The persisted map is the
   only permitted conversion from those labels to people.
5. Clear the evidence with transcript and summary at retention purge.

The collector must never derive a role from inbound/outbound direction,
telephone number, contact, authenticated account, CDR ordering, or Gemini
speaker order.

## Required commissioning proof

Run supervised inbound and outbound calls using two unique spoken phrases.
Save the raw FreeSWITCH snapshot and independently inspect each stored PCM
channel. The phrase, channel role, record-swap setting, stored identity, UI
label, copied transcript, translated transcript, and AI summary must agree in
both directions. Reject the entire mapping on the first discrepancy and keep
generic labels.

The unit suite covers malformed, missing, self-bonded, swapped, unanchored,
and ambiguous maps. It is not proof of a deployed media path or a handset
recording.
