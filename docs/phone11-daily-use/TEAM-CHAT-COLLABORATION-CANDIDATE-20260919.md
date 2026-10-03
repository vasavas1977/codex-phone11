# Phone11 Team Chat collaboration candidate — 19 September 2026

This is the implementation handoff for the Zoom screenshot parity design. It is **not a deployment or handset acceptance record**. The working installed standalone app has not been replaced during this implementation pass.

## Implemented in the shared app and service

- Left-aligned avatar gutter, restrained own-message tint, Thai/English 17-point body text, grouped sender metadata, Edited labels and date boundaries. Profile initials remain a fallback; photo profile management is not yet implemented.
- Server-authoritative root reply totals, original-message context in Replies, separate conversation/thread drafts, failed-send retry and new-message jump.
- Reactions with counts, selected state and reacting names; own-message edit/delete; deleted parents retain reachable replies.
- Private saved messages, shared pins, same-workspace forwarding and notification mute enforced at enqueue and dispatch.
- Binary photo/file uploads, captions, camera/photo/video/file selection, pending image thumbnail/removal, authenticated image viewer, authorized file download/share. Maximum 10 MiB per attachment and ten attachments per message. PDF, text/CSV, images, selected audio/video formats, and DOCX/XLSX/PPTX are supported. Office packages receive bounded structural format admission only; this is not malware scanning.
- Voice-note recording with permission, 60-second bound, review/cancel/add-to-draft; explicit final send. Inline audio/video playback has custom controls and participates in the existing call/meeting media ownership coordinator.
- Foreground activity heartbeat and real short-lived availability; mapped teammate voice-call action. Unknown availability is never presented as Available.
- User-triggered link preview with only title/description/domain, pinned public DNS, redirect/deadline/size controls and no remote image tracking.
- Feature-gated thread summary, selected-language translation, composition/refinement. Generated text is reviewed and only placed in a draft on explicit action. No automatic sends.
- Desktop inbox rail at wide widths, mobile back navigation and keyboard-avoiding composer.

## Deployment prerequisites

1. Confirm the current Phone11 auth database and active backend identity. Preserve the currently accepted Siprix/wake and ordinary notification configuration. Repeat current idle-call guards before any backend recreation.
2. Apply additive schemas in order: `server/chat/migration.sql`, `server/chat/collaboration-migration.sql`, `server/chat/media-migration.sql`. These source files are never auto-applied by the app. Back up and use the approved migration mechanism for the exact environment.
3. Provision a durable, non-public `PHONE11_CHAT_MEDIA_PATH`. The compose candidate mounts `/var/lib/phone11/chat-media`; the image creates it owned by runtime UID/GID 1001 with mode 0700. Verify actual mounted ownership/mode, writable free capacity, backups and retention operational policy before enabling uploads. Existing mounts do not inherit new image permissions automatically.
4. Deploy and verify the server before distributing the client. New history hydration, notification mute, collaboration and media endpoints require all new tables. Capture the current image/config for rollback. Keep migrations additive; do not drop stored customer content during rollback.
5. Keep `PHONE11_CHAT_AI_ENABLED=false` until the configured Gemini model/key and tenant data handling are approved and a scoped provider request is validated. Capability UI remains hidden while unavailable.
6. Create a new **signed standalone** iPhone build using `preview-ios-siprix-daily-pilot`; do not install a development launcher or uninstall the user's working app. New picker modules require native rebuild. Candidate runtime is `1.0.0-siprix-daily-pilot-chat-media-2`; the signed-app checker compares it with the pinned older calling baseline. OTA remains disabled.
7. Verify signed artifact identity, production APNs, native Siprix frameworks, both registered pilot iPhones and embedded JS. Then provide the EAS build-details installation page and QR. Never recycle the Build 70 QR as if it contained these changes.

## Remaining reference scope

This increment does not yet constitute every Zoom feature. Remaining product work includes real profile photos, typing events, full GIF/sticker/emoji search, dedicated video-message capture, recipient delivery/read receipts, thread following/reminders, per-tenant enterprise content policies, and the desktop third Replies pane. Chat-to-meeting invitations require the existing Connect11 service and membership mapping to be validated; no decorative video or AI button is shown as a substitute.

## Acceptance on the new signed build

Use pilot accounts 3001 and 1020 in both directions. Verify text, Thai/English wrapping, photo portrait/landscape viewer, attachment+caption, voice note, video playback, five replies, reactions, edit/delete, private saves, pins/forwarding, muted/unmuted notifications and retained drafts. Switch workspaces/accounts during media loading and ensure no old account media opens. Remove membership and retry download/mutation. Interrupt recording and playback with a real incoming call; confirm ringing, answer and two-way audio with the screen locked and over mobile data remain working. Test the composer with the iPhone keyboard shown. These are device gates, not claims made by local test suites.

## Earlier candidate verification (before the mentions increment)

- 143 tests passed across 16 focused app, transport, persistence, media, tenant/owner, link-preview and AI suites. Includes recorder shutdown retry and overlapping SIP request regressions.
- Disposable PostgreSQL checks: 57 collaboration/ordinary-notification tests and 10 protected-media HTTP/storage tests passed. These are isolated local databases, not production tests.
- 12 signed-profile/native packaging guards passed. TypeScript, backend bundling and whitespace checks passed. The pinned pnpm 9.12.0 frozen lockfile was checked in an isolated package copy.
- Final iOS and Android production JavaScript/Hermes exports succeeded in `/tmp/phone11-chat-final-ios-20260919` and `/tmp/phone11-chat-final-android-20260919`. These are not signed native applications.
- Shared message rows were inspected in light/dark browser layouts at 320/390 points; long message-action sheets are bounded and scrollable. Browser checks do not prove iPhone keyboard, permissions, native audio or push.
- Snapshot hashes are in `TEAM-CHAT-CANDIDATE-EVIDENCE-20260919.json`. The checkout also contains pre-existing unrelated work; these hashes do not certify that work for release.

The subsequent read-only runtime inspection identified the active VoIP-host backend and verified that collaboration/media schema and durable attachment storage are missing. The exact runtime, preservation requirements and narrow rollout plan are recorded in the signed-build readiness document. No backend migration/recreation, provider AI request, remote publication, new signed build, installation or QR handoff occurred in this pass. `TEAM-CHAT-SIGNED-BUILD-READINESS-20260919.md` records the safe standalone build lane and current release prerequisites.

## Mentions and shared-content increment

- Verified person mentions: choose a current conversation member from the existing + menu, search by name/extension, insert and highlight the named reference. The service validates the recipient's current membership and exact text range. Pending sends preserve mention IDs/ranges for offline retry; legacy text stays compatible. This does not implement @all, a Mentions inbox, or special mention-notification policy.
- Conversation details: tap the header for current members and authorized media/files/links from the latest 100 messages. Membership is checked again for downloads. This bounded recent view is not a complete archive browser.
- Loading failures stay inside the details panel with Retry. Async results are guarded against account, workspace and room changes. The member picker scrolls/searches instead of clipping later members.
- Added DOCX/XLSX/PPTX structural admission and protected download; legacy binary Office, encrypted, macro, embedded-object, ZIP64 and data-descriptor packages are outside the supported subset. This is format validation, not malware scanning or an inline Office editor.
- Fixed a real native-plugin conflict: image-picker configuration previously removed microphone permission. The prebuild regression now checks microphone/camera/photo descriptions and wake/APNs on iOS, plus microphone/camera permissions on Android. The signed-IPA gate also checks permissions and calling background modes.

This increment is still local source. The installed Phone11 and live calling service were not replaced. No new installation QR exists for this candidate.

### Verified after the increment

- 147 distinct focused tests passed across 17 suites: the 14-suite integrated run (109), owner/transport (24), and scope UI (14). Scope UI includes delayed details replies after room, workspace and account changes; the 75-test worker run also rechecked controls and mention/persistence behavior.
- Real disposable PostgreSQL: 58 collaboration/notification tests, 7 protected media HTTP tests, and 4 media storage tests passed. No production messages were sent.
- TypeScript and backend bundle passed. iOS and Android JavaScript/Hermes exports passed into `/tmp/phone11-chat-increment-ios-20260919` and `/tmp/phone11-chat-increment-android-20260919`; neither is a signed native binary.
- Real isolated Expo prebuild passed iOS wake/chat configurations 0/0, 1/0, 1/1 and Android permission assertions. Five native/profile guard tests passed. The strengthened signed-app verifier passed its 20 checks against the retained Build 49 baseline with the explicit baseline-only flag; that verifies the checker, not the new candidate.
- Browser: member search and insertion, details open/close, Thai/English wrapping, light/dark appearance and 320/390 widths inspected. Corrected the narrow composer clipping. Preview is synthetic and cannot establish actual iPhone keyboard/media/push behavior.
- The refreshed evidence manifest hashes current bounded source. It is not release provenance for the rest of this dirty checkout. No live deployment, signed new build, handset installation or installation QR was produced.
