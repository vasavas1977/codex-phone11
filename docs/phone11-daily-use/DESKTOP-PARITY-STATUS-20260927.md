# Phone11 desktop Phone and Meetings status — 27 September 2026

## Assessment

The Electron client is a useful desktop trial with meaningful Phone and
Meetings source. It is not a complete Zoom Phone/Meetings replacement or a
released daily-use desktop client. This is a source and documentation review;
it does not verify a current deployment, a packaged runtime, or customer
accounts. Use Phone11 branding and data throughout; no Zoom account names,
contacts, rooms, or records belong in the product.

## Feature and acceptance matrix

| Area | Present in desktop source | Main gaps | Acceptance still required |
| --- | --- | --- | --- |
| Phone calling | Authenticated assigned extension; number/extension dialpad; one active call; answer/end, mute, hold/resume, DTMF; selected line display. | Contact or directory search; call waiting/multiple calls; transfer, conference, park; richer line and business-phone controls. | Repeated inbound/outbound calls and two-way audio on each signed OS package; prove call lifecycle and interruption behavior against the PBX. Do not enable provider-available controls until the PBX/policy and signed-client paths are accepted. |
| History | Own selected-tenant CDR activity for 30 days, capped at 50 rows; a selected row fills the dialpad without dialing. | Contact names, search/filter, older history and recording links. | Companion backend must accept and echo the selected tenant. Verify current CDR ingestion and per-user ownership on the target service. |
| Voicemail | Selected-tenant personal inbox, private bounded playback, seek/pause/close, and mark-read after playback starts. | Delete/manage messages, transcription, broader mailbox controls. | Companion backend must return matching tenant identity and support selected-tenant read. Verify migration/storage/delivery and owner-only playback on the target service. Source does not prove voicemail delivery or live playback. |
| Meetings admission and media | Admitted-room selector; audio checks and optional prejoin camera preview; join/leave; mic/camera controls; participant roster; Gallery/Speaker layouts; receive remote audio/video and screen share. | New/scheduled meetings and invitations; chat; captions and language selection; host/cohost, lobby and moderation controls; local screen-share publishing; meeting artifacts. | Verify authorization, room lifecycle and reconnect behavior with multiple users; test camera and audio in both directions on signed macOS and Windows clients, and SIP interruption. |
| Release readiness | Electron source, helper supervision, local package workflows, and source-level/UI tests. A local ad-hoc signed macOS package is recorded in project docs. | Windows runtime proof and distributable signing/notarization; a verified paid redistribution license; persistent incoming-call guarantees when the app quits. | Complete the documented repeated-call matrix on signed packages for both OSes. Trial calls are limited to about 60 seconds. |

## Highest-priority gaps

1. **Make Phone usable by people and names.** Add a tenant-authorized directory and
   name search, then connect it to click-to-dial and searchable call history.
   Keep historical visibility tied to immutable call-time participation.
2. **Add daily call handling.** Implement transfer and second-call/call-waiting
   flows, then conference or park only where the PBX and account policy support
   them. Verify busy, cancel, answer/end races, call interruption and audio with
   two real endpoints before exposing each control.
3. **Complete the meeting workflow.** Start with create/schedule/invite, then add
   in-room chat and host/lobby controls. Add local screen-share publishing only
   after desktop OS permission and receiver interoperability are proven.

These are implementation priorities, not claims that related backend services
or provider features are currently deployed. The project benchmark classifies
meeting lifecycle, admission, chat, host controls and interpretation as core
safe usability work; scheduling and screen sharing are collaboration work. See
the [Meetings benchmark](ZOOM-MEETINGS-BENCHMARK-20260916.md) and
[desktop PBX media spike](DESKTOP-PBX-MEDIA-SPIKE-20260924.md).

## Evidence boundaries and other clients

The repository records source tests, UI tests and synthetic preview checks. The
latest desktop README records 37 desktop-app tests, 25 provider tests, 117
backend tests (one existing skip), TypeScript checks, a build, and a synthetic
renderer preview. These checks establish source behavior only.

Earlier project notes record a local Mac registration and an answered SIP
dialog reported by the owner. They also say there was no packet capture or
local CDR for that call, so two-way audio quality was not independently
measured. Windows runtime and distributable packages remain unverified. See
the [desktop boundary and personal inbox notes](../../desktop/README.md).

This matrix covers the Electron desktop client only. It makes no assessment of
mobile Phone/Meetings feature parity or enterprise admin capability/readiness;
those require their own current source and device/service review. Do not infer
mobile or admin behavior from desktop code.
