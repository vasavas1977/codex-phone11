# Phone11 Team Chat UX update — 19 September 2026

## Scope

Implements the approved cleanup from the owner's Phone11 and Zoom Team Chat
screenshots. Shared React Native UI remains theme-aware. No messaging transport,
tenant authorization, notification entitlement, or calling configuration changes
are part of this update.

- Compact conversation header; search/report/block in an overflow menu.
- Long-press or accessible More actions for messages; separate report sheet.
- Replies view with original-message context, persistent reply destination,
  earlier-reply loading, visible failed-message retry, and protection from late
  requests after navigation.
- Compact inbox, All/Unread/Chats/Channels filters, Groups/Drafts under More.
- Searchable teammate picker that opens direct messages on selection; distinct
  group/channel creation with visible progress and duplicate-submit protection.
- Root chat, creation sheet and report sheet keyboard avoidance; theme-aware
  status-bar icons and navigation background.

Attachments, reactions, mentions, voice notes, presence, photo avatars and
per-message read receipts are not added by this UI update. Existing Sent status
continues to mean server acceptance, not recipient reading.

## Evidence

Automated checks cover chat controls, scoped UI, inbox interactions, state,
ownership, persistence, transport, foreground refresh and appearance. TypeScript
and whitespace checks pass. 103 focused tests pass across nine suites; the two
release-profile guard tests also pass. Release profile checks retain the
standalone internal profile.

Browser verification renders the actual screens with React Native Web and local
fake auth/store/network data. It is not a company messaging or physical keyboard
test. Checked narrow 320px and 390px layouts, direct-message selection, group
selection/Create enablement, reporting sheet dismissal, message menus, consecutive
thread sends, a reply action on an existing reply staying in the active thread,
and dark/desktop-width rendering. Small-screen mode clipping and
desktop content alignment were corrected during review.

## Handset acceptance

Install in place with the signed `preview-ios-siprix-daily-pilot` profile only.
Do not substitute a development client. Retain known-good Build 66 for rollback.

On an iPhone, check the system clock/status icons in light and dark themes, Thai
and English keyboard placement in messages and report comments, long-press message
actions, Back from Replies, and two consecutive replies. On an authorized second
account verify delivery, unread counts and absence of duplicates. Browser and
mocked tests do not establish those device/network results.

## Design references

- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066130
- https://support.microsoft.com/en-us/teams/chat/manage-chats-with-the-teams-mobile-app
- https://adoption.microsoft.com/files/microsoft-teams/chat-and-channels/Teams-new-chat-and-channels-user-guide.pdf

## Release candidate

Build 68: https://expo.dev/accounts/vasavas/projects/phone11ai/builds/f8a54afc-bcf4-43b6-83f4-bc3dfe9c8372

Build 67 was withheld after final review found two thread edge cases. Build 68
contains the fixes and regression tests. The signed IPA passes Siprix bridge/framework verification and all 18 iOS
release checks, including production APNs, embedded JavaScript, debugging disabled,
strict signature, retained bundle identity, and registered-device coverage.

IPA SHA-256: `66022ae080ae89fc5a33804068dfd2cef0fbdb91bd640cc95941ca5099c148a0`.

Source hashes at upload (verified unchanged afterward):

```text
fc7a5530968acd64b9adbc4e9c874978324622f926587e24209b1cb34b5d5f7a  app/_layout.tsx
7eb7ec1f9d10ef5493f13b9c8d47f86092a002844b58a78c19eb01dfac1a3cd0  app/(tabs)/teamchat.tsx
a4a6094088fc3ff79580b960fe8917cb9f376e4a86f44ce6354bdba4b2ca5d91  app/chat/[id].tsx
```

Install QR: `artifacts/Phone11-build-68-install.png`.

Installed in place on the paired iPhone 17 Pro Max at 12:56 Bangkok time on
19 September 2026. Device inventory confirms version 1.0.0, bundleVersion 68;
launch succeeded at 12:57. The first connection attempt failed; the second
completed. No uninstall or development-client substitution was performed.
Physical keyboard layout and live second-account delivery remain user acceptance
checks; installation/launch do not prove those behaviors.
