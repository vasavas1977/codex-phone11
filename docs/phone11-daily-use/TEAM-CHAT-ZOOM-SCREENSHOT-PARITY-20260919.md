# Phone11 Team Chat: Zoom reference and upgrade specification

Research date: 19 September 2026. Research/design deliverable; this document does not mean the capabilities have shipped. Build 70 is the existing visual baseline. It is not Zoom feature parity.

## Evidence and scope

Owner references: `IMG_0839.PNG` (Replies), `IMG_0838.PNG` (conversation with image threads), `IMG_0837.PNG` (conversation with links and reactions), in `/Users/vasavas16macbookpro/Downloads/`.

The screenshots establish visible layout, not hidden menus or implementation details. Zoom Help establishes documented behavior. Numeric layout values below are proposed Phone11 values, not claimed Zoom specifications. Follow Phone11 branding and existing light/dark preference. A link card mentioning LINE in the third screenshot is ordinary shared content, not a request for LINE integration.

All visible screenshot capabilities belong in the target scope. Additional documented conveniences are explicitly distinguished below. This is not a claim to have exhaustively inventoried every Zoom product or plan.

## Screenshot feature inventory

| ID | Evidence | Visible feature | Phone11 target behavior |
| --- | --- | --- | --- |
| Z01 | Images 2–3 | Back chevron plus 99+ badge | Return to inbox preserving filter and position; accessible unread-conversation count. Exact Zoom badge-count scope is not established by these images. |
| Z02 | Images 2–3 | Photo, name, truncated long name | Actual account profile photo with initials fallback; tappable identity opens conversation details. |
| Z03 | Images 2–3 | Available with green dot or phone glyph | Real presence, freshness and device context; never infer availability merely from a directory entry or SIP registration. |
| Z04 | Images 2–3 | Video and telephone buttons | Resolved teammate identity initiates supported audio/video flow; group meeting action uses group context. Capability and membership must be checked. |
| Z05 | All | Header AI symbol | Phone11 AI entry point; exact contents of Zoom's unopened header menu remain unverified. |
| Z06 | All | Sender name and date/time above content | Quiet metadata, local dates, photo gutter, consistent identity and grouping. |
| Z07 | Image 1 | Own and received messages left-aligned | Shared reading column for all messages; own identity may say You, with a subdued blue-gray bubble. No alternating SMS-style right alignment in this target layout. |
| Z08 | All | Rounded, content-sized bubbles | Expand for Thai/English text; preserve paragraphs; avoid unnecessary full-width bubbles for short replies. |
| Z09 | Images 1–2 | Consecutive sender grouping and date boundaries | Reduce repeated identity for adjacent same-sender messages; reset grouping at a day change or substantial time gap. |
| Z10 | All | Inline image attachments | Preserve aspect ratio; landscape screenshots use the content width, portrait images stay bounded; tap opens a zoomable viewer. |
| Z11 | Images 1–2 | Text and image appear as one message block | Caption, media and actions belong to one stable message ID; reactions/replies address the whole message. |
| Z12 | Image 2 | 5 replies / 1 reply with chevron | Keep accurate server-provided reply counts visible beneath roots. Tap opens Replies. Never compute totals from only loaded messages. |
| Z13 | Image 2 | AI symbol beside reply count | Thread summary operates on that root and authorized replies; show relevant scope and generation state. |
| Z14 | Image 1 | Replies screen with original message and image | Parent content first, separator, chronological replies, Reply composer, back to original scroll position. Parent need not stay fixed during scrolling; screenshot does not prove that. |
| Z15 | Images 1–2 | Edited label | Edits update content, thread, preview and search consistently; display the edit marker. |
| Z16 | Image 3 | Thumbs-up pill, count, add-reaction button | Tap to toggle own reaction; show count and selected state; open participant list through an accessible action. |
| Z17 | Image 3 | Blue clickable URL | Linkify allowed web URLs, retain copy/select behavior and show the destination. |
| Z18 | Image 3 | Link preview title, description, domain | Optional preview card, useful fallback to plain link when preview unavailable. Never fetch private/internal network URLs. |
| Z19 | Image 3 | Small reply-add icon | Provide a quiet, discoverable reply action for roots with no replies; long press remains a secondary route. |
| Z20 | All | Bottom composer with plus, text, emoji, microphone | One compact anchored composer; context says Message [name] or Reply. Sending text remains explicit. |
| Z21 | All | Attachment plus | Open attachment/tool tray; select/capture, preview, caption, remove, send. |
| Z22 | All | Smiley | Emoji entry and, when supported, searchable GIF/sticker selection. |
| Z23 | All | Microphone | Voice recording with permission, timer, stop, review, cancel and send; this is a voice message, not a live call. |
| Z24 | All | Dark neutral surfaces and spacious text | Match hierarchy and restrained contrast in both themes. OS battery, charging banner and Dynamic Island are not app controls. |

## Verified Zoom behavior

Zoom documents message threads, reaction toggling/counts, the list of reacting people, message formatting and policy-controlled editing/deletion. Those behaviors support the visible reply counts, reaction pills and Edited labels. [Replies and editing](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066130).

Mobile attachments can come from photos, camera and files; users can add accompanying text before sending. File controls are subject to administrator policy. Phone11 should define its own supported types and limits from its storage/processing capacity, rather than silently adopting Zoom's limits. [Files and photos](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064413).

The mobile voice flow includes start, stop, playback, cancel and send. Zoom's dedicated article describes a 60-second voice limit and a mobile video-recording flow, but also contains an inconsistent note restricting video sending to desktop. Treat exact mobile video availability as requiring version/device verification. [Audio and video messages](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060859).

Zoom documents synced availability and a distinct mobile-only Available indicator. Presence is separate from message delivery and read state. [Presence status](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065488).

Thread summarization and AI-assisted composing are distinct features. Summary controls include copying, translation and feedback; composing produces an editable draft. Availability depends on settings and account eligibility. The exact action behind the unopened header sparkle cannot be established from a screenshot. [Chat summaries](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0057619), [AI composition](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058033).

Zoom also documents private bookmarks, shared pins, forwarding, following threads and reminders. These are supporting parity features beyond what these three screenshots display. [Managing messages](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061883).

The broader composer supports additional content/tool choices, and notifications can be configured by conversation. Mobile settings include optional link previews. [Chat overview](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918), [Mobile settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062534).

Enterprise parity includes controls for file sharing, voice/video messages, editing/deletion, external collaboration, retention and AI access. These need policy enforcement rather than decorative settings. [Chat administration](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058688).

## Current Phone11 gap audit

A read-only source audit checked the current shared UI, model, service and routes. Present below means implemented in source, not newly proven on devices during this research.

| Capability | Current status | Evidence |
| --- | --- | --- |
| Text chats, groups/channels, history/search, retry | Present | `server/chat/service.ts:76`, `server/chat/router.ts:20` |
| Replies screen and parent context | Present for text; partial parity | `app/chat/[id].tsx:325`, `server/chat/service.ts:169` |
| Visible reply totals | Missing | `lib/chat/types.ts:11` has no reply-count field; discovery currently uses the message action menu |
| Photo avatars | Missing | `app/(tabs)/teamchat.tsx:137`, `app/chat/[id].tsx:832` render initials |
| Real chat presence | Missing | `lib/presence/engine.ts:1` labels its separate implementation as simulation; chat directory has no presence data |
| Audio/video buttons for the current peer | Missing from room | `app/chat/[id].tsx:611`; inbox Meet exists separately at `components/meet-action.tsx:8` |
| Images/files, media viewer and voice/video notes | Missing | `server/chat/migration.sql:23` and `lib/chat/types.ts:11` are text + parent only |
| Linkification and preview cards | Missing | `app/chat/[id].tsx:923` renders content as plain text |
| Reactions and dedicated emoji/GIF picker | Missing | No reaction schema/routes; `app/chat/[id].tsx:1078` is a plain multiline input (OS-keyboard emoji text still works) |
| Mentions, bookmarks, pins, mute preferences | Missing | No corresponding model/routes; persisted drafts are not bookmarks |
| Edit/delete and Edited metadata | Missing | `server/chat/router.ts:20`, `app/chat/[id].tsx:1216` |
| AI summary/compose/translation for chat | Missing | Recording AI is a separate capability; no chat AI route |
| Unread/read state | Partial | `server/chat/service.ts:90` uses real read cursors; no recipient-delivered/read receipt UI or typing events |
| Reading-position behavior | Partial | `app/chat/[id].tsx:724` avoids unconditional bottom scrolling; no first-unread divider or New messages jump |
| Independent thread drafts | Missing | `app/chat/[id].tsx:116` reads drafts by room ID |
| Desktop inbox/conversation/replies split | Missing | Separate bounded-width routes in `app/(tabs)/teamchat.tsx:165`, `app/chat/[id].tsx:1441` |

The main service already enforces membership and tenant scope. Extend that service, preserving authorization and idempotency. A generic unread cursor must not be presented as a recipient delivery receipt. Existing simulation code must not power a live Available badge.

## Phone11 design decisions

1. Use a consistent avatar gutter and left-aligned reading column for both senders. Incoming bubbles are neutral, outgoing bubbles subtly tinted. Preserve sender identity even when color cannot be perceived.
2. Keep real thread counts and existing reactions visible. Hide secondary actions in long press/overflow; do not hide the existence of an active discussion.
3. Header: back/unread, photo, name/status, audio, video and AI. On narrow screens, preserve readable identity and move secondary tools into More. Never shrink touch targets to force every icon onto one row.
4. Provisional mobile metrics: 17-point body, 13-point metadata, 36–40-point avatar, 44-point minimum touch targets, 12–16-point outer spacing. Thai line height should start at 23–25 points and be checked with Dynamic Type and combining marks. These are Phone11 starting values, not measured Zoom values.
5. Composer: plus, growing text area, emoji and microphone when empty. A send control appears for text/media drafts. Expand to a bounded height, then scroll the input; keep Send accessible above the keyboard.
6. Opening attachments or AI must preserve room/thread drafts. Replies own a separate draft keyed by tenant, user, conversation and root message. Do not overwrite the main-room draft.
7. Maintain reading position on new arrivals and image loads. Show a New messages jump affordance when reading earlier content; expose a first-unread boundary when known.
8. Long press and VoiceOver actions open the same menu: react, reply, copy, private save, forward, allowed edit/delete and report. Destructive operations require a clear consequence and confirmation.
9. Conversation details: members, shared media/files/links, search, notification preferences and permitted management actions. Private saves and personal tasks are distinct from shared pins.
10. Desktop uses inbox + conversation + optional replies/details pane, keyboard navigation, hover actions, drag/drop and file previews. Narrow web layouts collapse to mobile navigation. Mobile screenshots alone do not specify desktop geometry.

## Delivery boundaries and order

The main risk is trustworthy shared-content delivery: authorized upload/download, recovery, consistent message/thread identity and notifications across two devices. Prove that service path before presenting attachment buttons as finished features.

**First complete daily-collaboration increment:** shared media model and protected uploads; inline images/files and viewer; server reply counts; visible thread navigation; grouped reference-style layout; reactions; functional emoji/attachment composer; separate thread drafts. This is the smallest increment that materially matches these screenshots.

**Next increment:** edit/delete markers and policies, safe link previews, private bookmarks, shared pins, forwarding, mentions, notification preferences and first-unread navigation. Add real photo profile support and chat-to-call actions using current account mappings.

**Then media/presence/AI:** voice notes and video messages, typing/presence, optional real receipts, thread summaries, translation, compose/refine and chat-to-meeting integration. Preserve live-call microphone/audio ownership when recording a voice note. Every named capability stays in the target; this order is implementation sequencing, not feature removal.

Build shared iOS/Android behavior and desktop layouts explicitly. Continue signed standalone iPhone distribution; implementation and release results must be recorded separately.

## Acceptance scenarios

- Send Thai/English text plus landscape and portrait images from 3001 to 1020, then reverse. Confirm single delivery, correct sender, image viewer, canceled uploads, offline retry and no duplicates.
- Add five replies, including an image, from both accounts. Root shows five even after pagination or reopening. Replies show original content; Back restores room position; room and reply drafts remain distinct.
- Add/remove identical and different reactions from both phones. Counts and membership converge after reconnect; removed members cannot read or mutate the message.
- Edit an allowed own message. Other phone, search, root preview and notifications resolve the latest permitted state; test deletion and denied policies separately.
- Test safe links, missing preview, large text, failed image and expired access. Incoming activity and downloaded media never jump a user away from earlier reading.
- Record, review, cancel and send voice; test denied permission and active-call interruption. AI draft never sends itself; canceled/failed AI requests leave the original conversation usable.
- Test 320/390/430-point layouts, keyboard in both languages, font enlargement, VoiceOver, light/dark, desktop keyboard and split view.
- Foreground/background/locked notification delivery must open the exact authorized room/thread. Tenant separation, membership removal, private bookmarks and private recording follow-ups must hold for every content type.

## Definition of done

The reference is met only when visible controls have working services and the two-account acceptance scenarios pass on signed builds. Source tests, mockups, an installed build, and screenshot resemblance are separate evidence layers. Do not describe another visual cleanup as complete feature parity.
