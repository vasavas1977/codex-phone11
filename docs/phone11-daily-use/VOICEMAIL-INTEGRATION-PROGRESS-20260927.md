# Voicemail integration evidence — 27 September 2026

Workspace status is live on the separate 3012 API. This voicemail work is still
source/private staging; no production voicemail route, mailbox flag, storage
migration, relay, or FreeSWITCH XML binding was activated in this pass.

## Completed integration

- Local fallback authority resolves caller and destination within the same
  tenant, current assignment, active membership and voicemail owner epoch.
- One-use Redis references expire after 30 seconds and bind original SIP
  Call-ID / From tag. Redemption checks current authority again. Producer
  admission can require the redeemed owner epoch under the database lock.
- `/api/voicemail/local-fallback/{mint,redeem}` is mounted before the general
  JSON parser and remains disabled by default. Independent source review of
  `f9d7c32a430099c991806db9f6f9155168a17374` found no P0–P2 issue in this delta.
- Directory candidate verifies the exact directory bind and the XML hash as
  seen inside FreeSWITCH. Live mutation remains disabled because an unfenced
  XML-curl module reload can race a REGISTER lookup in FreeSWITCH 1.10.12.
- Read-only worker handoff checks distinguish backend processes from Redis,
  Kamailio and FreeSWITCH. They do not perform a worker handoff.

## Runtime evidence

The isolated exact-image XML curl fixture at source
`f73a04a4de5c71edcf9b191da21384e45aff83cc` passed both synthetic extension
lookups, missing/wrong credential rejection, and credential rotation. Evidence:
`/var/lib/phone11-fs-directory-fixture-20260927/capture-f73a04a`, transcript
SHA-256 `6e4730f7f9ea9025b0eada3e8752ad49b63e7ea01901251e52d90732a33b2e9e`.
It demonstrates module behavior in an isolated clone, not live reload safety.

The isolated Kamailio fixture at `b88d211` ran on pinned image
`sha256:f7c3a2412b49f1372c70b2ad06da6f28cb34a044ee3ae408c7b960ef484bb5b7`.
All six scenarios passed: no answer (one fallback), cancellation before/during
HTTP, late HTTP, busy, and busy followed by another fork answering (no fallback).
The real SIP packet preserved original Call-ID/From tag and carried the exact
opaque reference in `phone11-vm-<reference>` R-URI. This is transaction/binding
proof only; media conversion and actual handset voicemail remain unverified.

## Remaining delivery

Implement and prove a quiescent directory transition; integrate the dedicated
FS ingress adapter; commission storage and relay; add the narrowly gated proxy
route and SRTP/RTP media conversion; validate a private deposit and owner-only
playback on the approved 3001/1020 phones. DND worker deployment and fresh
meeting invitation/audio acceptance remain separate unfinished items.
