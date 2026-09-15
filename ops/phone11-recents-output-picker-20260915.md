# Phone11 Recents, summary tools, and audio output picker

Date: 2026-09-15. The backend update is deployed and independently verified.
Signed Build 49 is installed and launched. Physical audio/output acceptance
remains a separate gate.

## Backend source and candidate

- Exact source: `5d67771fca833ca3675c9f49066b97ac03c4fab2`.
- Candidate tag: `phone11-backend:summary-tools-5d67771`.
- Candidate image: `sha256:31bc9f370625c1a4df26c6b4d8a2f0e0c3ccf116699e20a1d1ecf804162cae2d`.
- Bundled server SHA256: `d32b1df82341adba985429f32a5977937a88cbdca048a5f1d4ff01308a2477ae`.
- A side-effect-disabled candidate used a localhost-only port, returned the exact
  source from `/api/health`, and was removed before deployment. Capture, AI,
  retention, cleanup, notification, wake, and both ESL paths were disabled in
  that probe.
- The protected candidate, probe evidence, image build log, pre-deployment
  inspect, runnable rollback compose, and deployment result are retained under
  `/opt/phone11ai/summary-tools-5d67771-20260915` on the server. The runnable
  rollback file is `rollback-compose.json`; `predeploy-inspect.json` preserves
  the exact prior runtime snapshot.

The reviewed local release helpers are retained in
`/tmp/phone11-summary-tools-deploy-review/`. The read-only gate is
`run-remote-idle-guard.sh`; the gated replacement wrapper is
`run-remote-deploy.sh`. The generic mobile-branch redeploy helper was not used.

## Deployment controls

Immediately before replacement, the authoritative guard reported:

- zero FreeSWITCH channels;
- zero Kamailio dialogs;
- zero RTPengine calls;
- zero pending or recording captures; and
- zero processing AI jobs.

The deployment script acquired an exclusive lock, required the exact prior
backend source and image, compared the fully resolved candidate with a fresh
live inspect, generated a protected runnable rollback compose, repeated the
configuration comparison and idle guard, and replaced only `cp11-backend`.
It then verified the new image and exact health, the preserved runtime, and
unchanged FreeSWITCH and Kamailio container identities. The replacement exited
successfully.

The idle guard queries PostgreSQL directly and can therefore protect a rollback
even when a failed candidate backend cannot run. This failure branch was tested
read-only with a deliberately nonexistent backend container name; the
FreeSWITCH, Kamailio, RTPengine, capture, and AI-job checks still completed and
reported zero. No live service was stopped for that test.

## Independent post-deployment proof

- Local and public health both returned `ok: true`, service
  `phone11-backend`, and exact source
  `5d67771fca833ca3675c9f49066b97ac03c4fab2`.
- The running image is the exact candidate image above.
- A fresh live inspect matched the protected pre-deployment snapshot for every
  environment value except the intended build marker, all five mounts, network
  and static IP, published ports, restart policy, memory limit, and CPU limit.
- Sanitized logs from the new container start prove that the FreeSWITCH event
  listener connected, authenticated, and subscribed to events. No log body,
  endpoint, credential, or customer data was retained in this proof.
- A synthetic unauthenticated POST to
  `cloudRecordings.tools.translate` returned HTTP 401 with tRPC code
  `UNAUTHORIZED`. This proves the new route is mounted and protected rather
  than absent. The request used no recording or transcript content.
- No Gemini request, authenticated recording API request, reprocessing, or
  customer-content read was made during verification.
- A fresh full-health guard after deployment reported exact source
  `5d67771fca833ca3675c9f49066b97ac03c4fab2` and all five activity counts at
  zero before the next signed-build installation gate.

## Physical acceptance still required

This backend proof does not establish handset audio behavior. Build 49 is
installed and launched on the paired iPhone. Physical acceptance must confirm a
real call has two-way audio, the professional recording announcement plays,
recording controls and mute remain usable, Stop recording settles correctly,
and Recents exposes playable media plus the summary, speaker-labeled transcript,
and translation UI. Repeated and locked-screen incoming-call behavior remains
part of the broader daily-use acceptance and is not proved by this server
deployment.

## Output picker source and checks

- Final signed-build source: `0d9b87b1fb408b7d8fc377a3fdb7ad32a959a6f6`.
- Shared picker/lifecycle commit: `8f3c366`; native iOS picker commit: `2d2c5fb`.
- Signed workflow: https://github.com/vasavas1977/codex-phone11/actions/runs/34880323287
- Playback uses play/pause and double-arrow icons, a draggable timeline, and
  one Speaker button which opens the output picker.
- iOS uses public AVRoutePickerView; HFP and A2DP are enabled for the
  recording-playback session. Device discovery/names and the selected output
  stay under system control. No Bluetooth devices are fabricated.
- Native checks: staged SDK compile, 188 bridge assertions, 247 wake assertions.
- Shared focused tests: 36/36. All 72 workflow test files passed locally
  (694 passed, 12 database-gated skips); the actual four database CI jobs passed.
  The full app/service and native CI jobs passed before signing. Affected TypeScript paths are clean; full-repo
  tsc still reports pre-existing unrelated errors.
- Browser fallback popup visually verified at 320 and 440 pixels with synthetic
  content. Exact native output inventory/audio still requires handset acceptance.
- Build 47 (source d0cf247) completed signing but was not installed. The next
  icon-only workflow 34876952654 was cancelled when the user requested a picker;
  it has no build-job steps/artifact and is superseded by the workflow above.
- Build 49 supersedes the previous installed Build 46; package and installation
  proof is recorded below.

The preceding picker workflow 34878398518 correctly stopped before signing
when two screen-test mocks attempted to load a native icon dependency. Test-only
commit `965137d` fixes both mocks; no runtime code changed for that correction.

## Android parity checkpoint

The existing Android task reports shared icon/picker ports `c2c0c1d` and
`7577237`, test mocks `a9c0b82`, and Android-native AudioManager adapter
`9c569c9`. It preserves Android's keepAudioSessionActive option, actual
Phone/Speaker/Bluetooth device IDs, selected-route state, call-active rejection,
device refresh, and teardown reset. Reported validation: 55 Vitest tests across
eight files, two native/JVM tests, formatting/lint/diff checks. These are source
and test checkpoints, not physical Android Bluetooth audio proof.

## Signed Build 48 package

Build 48 completed signing at source `965137d33216dbdd1d497e87e1628f9df8b98848`.
The artifact passed deep/strict code signing, matching bundle/build metadata,
valid provisioning containing the paired handset, production APNs entitlement,
and embedded native picker symbol checks. IPA SHA256:
`9ab18488bf71e917fead88088967472b0751783feb8b7c749f4a029d70478b57`.
It was not installed before the user requested removal of the Billable call
option; the follow-up build must include that UI change.

## Billable call removal

User-requested source commit `0d9b87b1fb408b7d8fc377a3fdb7ad32a959a6f6`
removes the Billable call action and the billable line in exported call details.
Legacy stored metadata remains readable; no recording or billing data was
removed. Focused summary/metadata checks passed (8/8), and the browser menu was
visually checked without the action. The final workflow's native, app/service,
and four database jobs passed before signing.

The existing Android task reports the matching port as `33ae78c`, with 28
relevant summary, Recents, and recording UI tests passing plus formatting/lint.
The removal contains no native changes.

## Final Build 49 installation

- Source: `0d9b87b1fb408b7d8fc377a3fdb7ad32a959a6f6`.
- Workflow `34880323287` completed successfully, including all test and signing jobs.
- EAS build ID: `2cd780c9-dbdb-4964-a692-4ea30ce354b6`.
- Version: `1.0.0 (49)`.
- IPA SHA256: `e009bb13feec8b856eba8815917026a7e7a9976ffc1992afe3eae73d9b3fea66`.
- Deep/strict signature, provisioning expiry, paired handset inclusion,
  production APNs, bundle/build identity, and native picker symbols verified.
- Immediately before installation the full-health guard verified exact live
  backend source `5d67771fca833ca3675c9f49066b97ac03c4fab2` and zero
  FreeSWITCH channels, Kamailio dialogs, RTPengine calls, captures, and AI jobs.
- DeviceControl installation and launch both returned success. A fresh installed
  application inventory confirmed Phone11 version 1.0.0, bundle version 49.
- Local evidence: `/tmp/phone11-final-recents-build-20260915/`, including
  `verification.json`, `install-result.json`, `launch-result.json`, and
  `installed-apps.json`. Device identifiers are not reproduced in this document.
- iPhone Mirroring remains behind the owner's private Mac unlock screen.
  Physical receiver/Speaker/Bluetooth switching and audible playback have not
  been verified by this installation or the browser preview.
