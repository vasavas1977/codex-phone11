# Phone11 integration state — 1 October 2026

## Reviewed source

Feature source `9c0f9827b001dce0c76a261ceb5dcea6855258df` adds the protected mobile/web New meeting entry flow and custom business weekdays. Earlier source includes exact direct/channel invitation rooms, selected-workspace SIP/directory/history, avatar loading guards, status, administration and private voicemail admission. These are selected Zoom-style workflows; complete Zoom parity is not claimed.

Local validation on that source: 2,432 Vitest cases passed, 451 environment-gated cases skipped; 78 native Node cases passed. TypeScript, backend compilation, focused changed-code ESLint and staged diff checks passed. Independently reviewed meeting, weekday and fixture hashes matched integration. Backend compilation produces the same SHA-256 as the separately reviewed `7984cee` image: `4c879ba349e17a2d1292d726ed501c3ca6dbd6b035ae6dca755a083bdb0e1297`. Frontend/source identity remains distinct.

All 14 hosted PR checks passed on this source. The recording job initially timed out during Ubuntu package-index retrieval before test execution; only that job was retried, and its actual tests then passed. [Signed iOS workflow 36889086165](https://github.com/vasavas1977/codex-phone11/actions/runs/36889086165) also passed. Native and all seven daily-use prerequisite jobs passed, and signed daily-pilot Build 112 finished using existing credentials. EAS ID: `46b041f1-678d-4fbb-8b96-bb2fca30ae93`. Its IPA is 26,300,681 bytes, SHA-256 `a0215f92e05ee9b0c958332c4049816a29c2683fa7689f37b9d01a9a02c25046`; native verification and all 22 signed-package checks passed. It is not installed or handset-accepted.

The meeting-chat follow-up adds a bounded plaintext data channel to the exact authenticated desktop/mobile room, with SDK-owned sender identity, live grant checks and teardown guards. Local integration validation passed 2,475 Vitest cases with 451 environment-gated skips, 78 native Node cases, and full TypeScript. Desktop focused checks and a synthetic isolated Chromium transport rehearsal passed. Independent desktop and mobile reviews approved the pinned source only; mobile review independently passed 111 focused cases, TypeScript and focused ESLint. This follow-up is outside Build 112, and synthetic delivery is not real peer or handset acceptance. Mobile reuses authorized participant avatars; desktop photo lookup is a separate follow-up.

The local PBX writer rehearsal passed 31 checks using actual restricted SCRAM login roles and four synthetic rows. Five observed compatibility/authority boundaries remain explicitly documented. Independent review accepted its exact source and captured synthetic evidence only. It is not a protected production clone and does not close real writer, trigger, schema or rollback admission.

## Isolated backend candidate

At 16:03 UTC, the independently reviewed locked operator started `cp11-api-candidate-mainline-7984cee` on loopback 3022. Its exact image, bundle, binding, runtime and health checks passed; four anonymous protected endpoints returned 401. All 35 pre-existing containers were preserved (36 total). Public 3016, baseline 3000, recovery 3004, Nginx, Kamailio and direct wake health remained unchanged. Independent captured-evidence review accepted these observations only.

No public route, production schema, provider mapping or credential changed. The candidate does not establish authenticated acceptance or deployment readiness. No eligible active denied-tenant fixture exists on the current one-active-tenant target. [Current writer audit](PBX-WRITER-AUDIT-FOLLOWUP-20261001.md) records why advanced PBX migration cannot be admitted from this inventory alone.

## Installed handset and media acceptance

The retained daily-pilot Build 111 comes from source `11cd1f199cd4cd79d133637ad59271a21014d9e8`. Mirroring previously verified navigation, default member selection, deselection/cancel, own-avatar profile and persisted Away/Automatic settings. Builds 110/109 remain available. Build 112 contains the reviewed entry/avatar source and remains staged; new feature source is not yet installed. The newer meeting-chat follow-up is outside Build 112.

A fresh source review found no concrete native audio defect explaining the historical two-way silence. The audio path is unchanged from Build 111. Sixty-four focused mocked lifecycle/media tests passed; they cannot prove capture or audibility. Next acceptance must record both build/account identities, test time, each direction's speech and remote Speaking indicator, selected Speaker route, volume/accessories and private native logs. A subscribed audio track badge does not establish decoded or audible audio.

Current live checks need the signed-in Phone11 portal and both phones, 3001 and 1020. Do not replace ordinary account authentication with extracted browser credentials or fabricated actor/tenant fixtures.

## Remaining product ownership

Super Number confirmed its canonical task service contracts are not a deployed event scheduling service. Reuse its reviewed authenticated task/event service when available; task focus intervals and immediate Phone11 rooms are not future meetings. The shared event/provider service remains unbuilt. Connect11 owns media/provider admission and visible-bot lifecycle; Phone11 owns consumer invitations, media controls and physical-device acceptance. Neither source coordination nor a provider probe substitutes for a Phone11 meeting test.

Voicemail ingestion stays off pending real admitted deposit and signed-device playback. Advanced PBX commissioning requires protected-clone rehearsal, accountable writer/rollback ownership and reviewed target changes. Fuller host moderation/waiting room, general collaboration beyond the reviewed meeting chat, transfer, emergency completion attribution and signed Windows distribution remain unfinished. Keep PR7 draft until its concrete release gates are met.
