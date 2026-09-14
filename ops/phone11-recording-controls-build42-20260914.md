# Phone11 recording controls and Build 42

Date: 2026-09-14

## Source and checks

- Recording-stop fix: `00d976712521f892f4ba9cace7d3843fbacd41eb`
- Transcript speaker-name fix: `c5ed9a6`
- Professional recording announcement: `24e8d08`
- Required Phone11 daily-use workflow `34839095813`: all five jobs passed.
- Signed iOS workflow `34839122945`: native checks, daily-use checks and signing passed.

The stop fix persists the confirmed PBX stop before replying, suppresses stale
Stop controls while the file finalizes, and displays `Saving recording...`.
Retryable start failures display `Not recording`. Speaker labels prefer handset
contact and signed-in user names, with distinct Speaker 1/Speaker 2 fallbacks.

## Live backend

The generic deploy workflow stopped before replacement because its historical
environment file did not contain `PHONE11_TRUSTED_PROXY_CIDRS`. The existing
backend remained healthy. The successful bounded deployment reused the exact
current runtime configuration and mounts, disabled workers in an isolated
candidate probe, and required zero active calls, zero active captures and zero
processing jobs immediately before replacement.

- Previous image: `sha256:cb460188ddf4d601750b3a3e2f6809a71aa14097eb715b10a47223bcfc60e192`
- Current image: `sha256:66d1ae327ae83b70033c2ff3ceac63d78cfe2cfcad1b4906b4fbd58c3deca484`
- Local and public health both reported exact source `00d976712521f892f4ba9cace7d3843fbacd41eb`.
- Kamailio and FreeSWITCH containers were unchanged.
- The live announcement file remained SHA256 `cad76a406f7607fdac2ee9cb798d47d47c75ba2670b44652781d85b772a4422f`.
- A private rollback configuration and deployment result are retained at
  `/opt/phone11ai/recording-controls-00d9767-20260914` on the server.

## Installed iPhone build

- EAS build: `96b0782b-9c60-4ecf-98cb-3ef61fbe0e0d`
- App version/build: `1.0.0 (42)`
- Bundle: `space.manus.phone11ai.t20260425073427`
- IPA bytes: `16,853,867`
- IPA SHA256: `6b47ede293aef8e0982922b1a47bd8a06288de3012b5a112978d6bb3f715ff91`
- ZIP integrity and embedded provisioning profile verified.
- Installation succeeded and independent device inventory reports build 42.

The phone was locked when launch was attempted, so opening Build 42 and the
physical call acceptance remain pending. Acceptance must confirm the short male
announcement on both sides, Stop changing to saving/finalized, two-party cloud
playback, summary/transcript, participant labels, Hold/resume, and repeated
locked incoming calls.
