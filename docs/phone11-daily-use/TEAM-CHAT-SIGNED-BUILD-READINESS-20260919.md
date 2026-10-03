# Team Chat signed iPhone build readiness — 19 September 2026

This is a source and release-lane inspection for the current Team Chat candidate. It does not authorize, start, install, publish, or prove a new device build.

## Selected lane

Use **only** `preview-ios-siprix-daily-pilot` for the next internal iPhone candidate. It is the standalone internal-distribution profile for the existing Phone11 bundle, uses the `siprix-daily-pilot` channel, enables the reviewed wake and chat-notification flags, and is the default/allow-listed profile in `.github/workflows/phone11-siprix-ios-build.yml`.

Do not use development, simulator, plain preview, wake-only, PJSIP, or store profiles. The release-profile guard passed on this checkout (2 checks) and confirms that no development-client profile may reuse the Phone11 bundle identifier.

## Native candidate identity

- Bundle ID: `space.manus.phone11ai.t20260425073427`.
- Version: `1.0.0`.
- Candidate runtime: `1.0.0-siprix-daily-pilot-chat-media-2`; the signed-app gate expects this exact runtime.
- Local `ios.buildNumber` is `5`, but this is not the candidate number: EAS uses remote app-version sourcing and the selected profile inherits automatic incrementing. The latest recorded signed build is Build 70. The next assigned remote build number is not known until EAS accepts the reviewed source and must be recorded from that build record.
- Build 70 is a usable rollback artifact for package inspection at `artifacts/phone11-build-70/Phone11-70.ipa`; its matching Build 49 baseline and prior verification JSON are retained beside it. Keep the existing installed app and a verified rollback IPA. Installation must be in place, never after uninstalling.

## Team Chat native requirements

The candidate adds native media dependencies that cannot reach an already installed standalone app through JavaScript updates:

- `expo-image-picker` is configured with explicit Photo Library and Camera usage text. The room selects photos and videos and can capture a camera photo.
- `expo-document-picker` is present and invoked for file selection. It has no custom iOS permission text in this configuration; verify its generated native integration in the signed artifact/prebuild rather than assuming a JavaScript-only update.
- `expo-image-picker` and `expo-audio` both declare nonempty microphone usage text for calls/voice notes. The previous image-picker `microphonePermission: false` removed the shared native permission after other plugins ran; this candidate fixes that conflict. `expo-audio` retains microphone usage text for voice notes; `expo-video` is configured for playback. Existing microphone/camera, audio/VoIP/remote-notification background modes, Siprix frameworks, production APNs, and commissioned notification markers remain part of the signed-package gate.

## EAS availability

The shell `eas` command is not installed and EAS is not a project dependency. The cached CLI is callable as `npx --no-install eas-cli` (24.7.0), and its non-interactive account query succeeded. This confirms local account access only. The checked-in signing workflow pins EAS 23.2.0 and requires its separate GitHub Actions secret; that secret and workflow dispatch ability were not inspected.

## What can happen before backend readiness

EAS can compile and sign the iOS package without a live Team Chat media backend, because the native build embeds the configured API origin and does not perform the protected upload/download acceptance flow during compilation. Do not distribute, install for acceptance, or describe the candidate as usable until the server is ready: additive Chat migrations must be applied, the durable non-public media directory must exist with verified runtime ownership/mode, and authenticated tenant-scoped upload/download must be reachable. The existing Team Chat candidate document lists those backend gates.

## Live backend preflight snapshot

Read-only AWS metadata in account `326786006484`, region `ap-southeast-7`, found two healthy production nodes and an `available` private multi-AZ PostgreSQL 16.13 instance. Their tags are infrastructure labels, not routing proof. The API-labelled node `i-0cc8f248b08c5f2fb` runs the older direct container `phone11-backend-public:7b0c678eeff3893ce53c964f17a88d76327299ab`; it has no Chat-media directory, feature flags, or required Chat tables and is not a media-rollout target.

The VoIP node `i-0851dd1ea1cfeef71` holds the observed active application runtime. `cp11-backend` is healthy on `phone11-backend:reverse-wake-20260919t074220z` (image ID `sha256:434a2ecc…`), with compose source `/opt/phone11ai/team-chat-notifications-20260919T140318Z/candidate.json`. Its direct health build and the public API health build both returned `5d67771fca833ca3675c9f49066b97ac03c4fab2` during this preflight. The API-host Nginx configuration contains multiple historical `api.phone11.ai` blocks, including proxy targets to this VoIP node and to its own loopback service. The matching direct/public build is current routing evidence, but the selected Nginx block must be rechecked immediately before any rollout.

The active runtime has `PHONE11_CHAT_NOTIFICATIONS_ENABLED=1` and `PHONE11_WAKE_ENABLED=1`; both must be retained. `PHONE11_CHAT_MEDIA_PATH` is unset, `/var/lib/phone11/chat-media` is absent, and no Chat-media mount is attached. The live database has core conversations/members/messages plus notification devices/outbox and their constraints, but not `phone11_chat_attachments`, reactions, or notification preferences. The collaboration and media migrations are not live.

The temporary EC2 Instance Connect key used for this read-only inspection was mode 0600, verified against pre-existing trusted host keys, and removed after each session. This was an authorized inspection method. No deployment, migration, restart, configuration change, or customer-data query occurred.

## Exact-runtime delta and rollback plan

1. Freeze the active VoIP-host image, compose source, direct/public health build, enabled flags, and call-dialog idle result. Stop if a call is active, direct/public builds diverge, or the selected proxy block changes.
2. Stage a new compose revision from the active source. Retain the APNs and recording mounts, `PHONE11_CHAT_NOTIFICATIONS_ENABLED=1`, and `PHONE11_WAKE_ENABLED=1`. Add only the candidate media path and durable non-public mount; do not replace the active volume topology.
3. Apply additive migrations in order: `server/chat/migration.sql`, `server/chat/collaboration-migration.sql`, then `server/chat/media-migration.sql`. Verify only schema names/constraints and media mount mode, owner, capacity, and writeability; never query message content.
4. Recheck the idle-call guard, recreate only the backend service, then verify direct/public health, both retained flags, the authenticated Chat route, and protected media metadata before any handset installation.
5. On image startup, health, schema, media-storage, or idle-guard failure, stop. Restore the saved active compose/image with both enabled flags. Retain additive schema unchanged; do not delete media or customer content.

## Build blockers and post-build evidence

1. This checkout has uncommitted Team Chat and unrelated work. Select a reviewed release commit and a clean workflow checkout first; the new build must report that exact SHA. A dirty local tree is not build provenance.
2. Review and authorize the exact-runtime delta plan above. It preserves the active reverse-wake image path, APNs and recording mounts, wake flag, ordinary-notification flag, and idle-call guard.
3. Keep Build 70 and the Build 49 baseline available. After an authorized EAS build reports `FINISHED`, record its immutable build ID, profile, source SHA, artifact URL, remote build number, and IPA SHA-256.
4. Run the existing read-only package checks against the downloaded candidate and retained baseline: `node scripts/verify-siprix-ipa.mjs` and `python3 scripts/check-phone11-ios-release.py`. The combined daily-pilot verifier is also present at `scripts/verify-phone11-daily-pilot-ipa.mjs`.
5. Only after both package checks pass, install in place and record independent device inventory. Then run the two-account Team Chat media, workspace-switch, revoked-membership, incoming-call interruption, and locked-screen acceptance scenarios. Signing and installation alone do not establish those results.

Current status: the internal signed-build lane and required native configuration are identifiable, and a prior Build 70 artifact has package evidence. The live baseline and missing Chat-media prerequisites are verified. There is no approved rollout, candidate backend image, applied collaboration/media migration, media storage, signed artifact, assigned build number, workflow source SHA, or physical Team Chat acceptance evidence for the current candidate.

## Native generation regression, current increment

The isolated real-template check `node scripts/check-phone11-native-prebuild.mjs` passed all three iOS wake/chat combinations (0/0, 1/0, 1/1) and Android generation. It verifies nonempty iOS microphone/camera/photo-library usage descriptions, native wake bootstrap, origin and commissioned markers, production APNs when enabled, and non-blocked Android microphone/camera permissions. Only project generation was exercised: no signed compilation, installation, or physical audio/camera acceptance is implied.
