# Phone11 Team Chat live acceptance — 19 September 2026

## Current installed build

- Signed standalone Phone11 Build 68 contains the earlier compact Team Chat UI, keyboard correction and commissioned ordinary-notification client. It does not contain the visible inbox and conversation redesign below. No development launcher is used.
- The live backend already contained the reviewed Team Chat notification repository, dispatcher and authenticated tap resolver. The additive notification tables were present before activation.
- At 14:03 UTC the ordinary message-alert gate was enabled by adding only `PHONE11_CHAT_NOTIFICATIONS_ENABLED=1` to the exact active reverse-wake backend compose definition. The backend image remained `phone11-backend:reverse-wake-20260919t074220z`.
- Deployment stage and exact rollback compose: `/opt/phone11ai/team-chat-notifications-20260919T140318Z/`. Candidate SHA-256: `4168dc636d9445eb291e02f1b7a73cdf3078ae4afb5072711b215d39abefa5a7`.
- Preflight required an idle call-dialog list and both notification tables. Backend recreation passed health checks. Kamailio, SIP transport settings and call routing were not changed.

## Source verification

The bounded implementation review found no source defect blocking acceptance. Focused chat suites passed 95 tests; notification component, settings, server and APNs suites passed 27 tests. TypeScript, release-profile guard and bounded whitespace checks passed. PostgreSQL cases were not rerun locally because that worker had no configured disposable PostgreSQL instance; prior migration evidence and live table presence are separate evidence.

## Signed visual candidate

The source now contains a visibly different Team Chat experience inspired by leading UC apps while retaining Phone11's existing capabilities and tenant checks:

- Inbox: compact title and workspace identity, icon actions, progressive search, **All / Unread / Chats / Channels** filters, initials avatars, restrained time and preview text, and compact unread badges.
- Conversation: compact back/title/member header, grouped sender identity, date separators, neutral incoming and restrained outgoing bubbles, long-press message actions, and a bounded keyboard-safe multiline composer with an explicit Send action.
- Always-visible **Reply / Thread / Safety** links were removed from the message canvas. Their existing guarded actions remain available through long press or the conversation menu.
- No attachment, reaction, voice-note or other capability is displayed unless the app already implements it.

Exact source SHA-256 values before the signed build:

- `app/(tabs)/teamchat.tsx`: `06d965e881ed6bc9296828c40080042e68286c2b7fa9b9a8d2cb504af32c69b6`
- `app/chat/[id].tsx`: `4dcb1fb59192a68ce6a44675170eba8adce843b0452880bcd7a102354752e7eb`

Focused visual suites passed 30 tests. The complete TypeScript check, 48 ordinary-notification tests, 16 signed-profile/native packaging guards and bounded whitespace check passed. The 320-point header review found and corrected action crowding; message actions now also expose a VoiceOver accessibility-action fallback while retaining the minimal long-press presentation.

Signed standalone Build 70 completed under EAS build `1bda4c6d-278f-427b-90c0-c687c5eadfc9`. Its IPA SHA-256 is `88bcf768d689c3a60d855d3c62db5efc8da65c25e84064933d285372e219c89a`. The signed-artifact gate passed all 18 checks. It was installed in place and launched on the connected iPhone, whose device inventory reported bundle version 70. Handset appearance and two-person behavior remain the acceptance boundary.

## Required handset acceptance

1. On both 3001 and 1020, open **Settings → Message alerts** and enable alerts for the selected Phone11 workspace.
2. Send one direct message each direction while both apps are open. Verify one message per tap, timely refresh and unread count.
3. Lock the recipient, send another message, verify the generic Phone11 alert, tap it and confirm the exact authorized conversation opens.
4. Repeat in the other direction.
5. Verify Thai and English keyboard placement, multiline overflow, reply context, older-message reading position and retry without duplicates.

Server provider acceptance, OS display and tap navigation are distinct checks. Do not claim locked-screen Team Chat acceptance until the two-device test is recorded.
