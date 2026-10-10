# Phone11 desktop UCC readiness

**Status: source audit — not a desktop release claim.**

Phone11's current browser surface is useful for reviewing shared data and
responsive presentation. It is **not** a native desktop calling client. The
web build deliberately has no SIP engine, CallKit-equivalent integration,
desktop audio-device control, background incoming-call service, or native
video renderer. A browser preview, a signed iPhone build, and a supported
desktop client are separate acceptance targets.

This document is the execution checklist for a desktop UCC client that shares
Phone11's account, directory, chat, recording and policy contracts without
pretending that browser UI equals desktop telephony.

## Current source evidence

| Area | What the responsive web UI can show now | What is not ready or must not be claimed |
| --- | --- | --- |
| Phone | Dial pad, extension/account status and recent quick-dial presentation exist in `app/(tabs)/index.tsx`. | `lib/sip/pjsip-engine.ts` returns no SIP bridge on web. Browser Phone UI cannot establish or receive a work call. |
| Recents | Search, All/Missed/Recorded filters, recording metadata, summary/transcript tabs and draggable playback timeline are shared in `app/(tabs)/recents.tsx` and cloud-recording components. | Native audio route inventory and device switching are iOS-specific. Browser presentation does not prove recording playback, download protection, retention, or speaker/Bluetooth selection on desktop. |
| Contacts | Team directory search and extension display use shared tenant-scoped directory data. | Device-address-book access is explicitly unsupported on web. Directory calling stays unavailable until desktop calling exists. |
| Team Chat | Signed-in browser sessions can load tenant-scoped rooms, messages, unread counts, search and composition through the same chat transport. | Browser UI does not prove desktop notification permission, background delivery, OS badges, system share targets, offline recovery or a two-account desktop acceptance run. |
| Settings | Appearance, assigned extension status, Recording & AI policy navigation, diagnostics and workspace-admin entry points are shared. | The preview wording and mobile reconnection controls must not be reused as desktop capability claims. Audio device, notifications and startup behavior need desktop-specific settings. |
| Recording, transcript and AI summary | Recording records, policy, summary/transcript presentation and speaker-label correction use shared authenticated contracts. | A real desktop capture path, protected desktop playback, named-speaker channel evidence, consent announcement, Gemini processing and retention lifecycle need their own proof. |
| Video and conference | `/call/video`, `/conference` and `/conference/room` intentionally render an unavailable state with a Back action. | Video, multi-party conference, screen share, camera selection and desktop media controls are not implemented. |

## Product layout to implement

The desktop product should be intentionally different from a stretched phone:

1. **Navigation rail:** Phone, Recents, Contacts, Team and Settings. Keep the
   active call visible as a compact persistent call strip. Do not use the
   handset bottom-tab layout as the desktop layout.
2. **Phone:** Directory/recent destinations on the left and dialer/keypad on
   the right. The active-call strip opens a dedicated call stage only after a
   supported desktop media adapter creates a real call.
3. **Recents:** Resizable list/detail panes. Selecting a call shows protected
   playback, an accessible seek bar, summary/transcript tabs, named speaker
   labels when verified, and an overflow menu. At narrow widths, stack the
   panes instead of forcing horizontal scroll.
4. **Contacts:** Directory and contact detail panes. A call action is enabled
   only when the selected client has a registered desktop calling account.
5. **Team:** Conversation list, message stage and optional member/info panel.
   Keep workspace switching and unread counts tenant-scoped. LINE customer
   traffic remains an external bridge timeline item; it never becomes a fake
   Phone11 member.
6. **Settings:** Account, appearance, recording & AI policy, audio devices,
   notifications, diagnostics and workspace administration. Device-specific
   options must report the current platform and permission state.

## Delivery order and acceptance gates

### 1. Shared desktop shell

- Add an explicit wide-layout breakpoint and navigation rail; preserve the
  current mobile layout at narrow widths.
- Support keyboard navigation, visible focus, Escape closing the topmost
  sheet, and logical focus restoration. Escape must never end a call.
- Test 1024x768, 1280x800 and 1440x900 at 100% and 200% zoom, in System,
  Light and Dark appearance. No horizontal page scroll or clipped primary
  action is acceptable.

**Exit:** keyboard-only and screen-reader review on realistic directory,
recents and chat data passes. This is UI acceptance only.

### 2. Desktop calling foundation

- Select and license a supported native desktop SIP/media adapter. It must
  implement SIP/TLS, SRTP, call lifecycle, microphone permission, output
  inventory, speaker/headset/Bluetooth choice, hold/mute/DTMF, reconnect and
  operating-system incoming-call presentation.
- Build a desktop-specific adapter behind the same Phone11 call contract.
  Do not use browser PJSIP absence as a fallback that silently simulates a
  call.
- Show a clear unavailable state in browser-only builds until this foundation
  has shipped.

**Exit:** two real endpoints complete repeated incoming and outgoing audio
calls. Verify microphone denial/recovery, mute, hold, headset/Bluetooth route
change, network loss/reconnect and app restart on a signed desktop build.

### 3. Recording and conversation intelligence

- Use the server-side recording object as the source of truth. Do not capture
  unprotected browser audio to invent a desktop recording.
- Enforce tenant/account authorization before playback, summary, transcript,
  export or share. Preserve private recording follow-ups unless the owner
  explicitly shares them.
- Display contact and signed-in user names only after the two channels have a
  verified mapping. Otherwise show neutral labels and offer a correction
  action.

**Exit:** a real recorded desktop call has verified two-leg capture, the
recording notice, stop/reconciliation, protected playback, retention, a
transcript, an AI summary and named-speaker evidence.

### 4. Video and conference

- Implement one-to-one video only after the desktop audio foundation has
  passed. Add camera picker, permission/recovery, renderer lifecycle and
  video-specific diagnostics.
- Add conference only after a server-side conference/SFU architecture has
  durable participant state, admission checks, moderation, reconnect and
  observability.

**Exit:** video and conference receive a separate signed-desktop acceptance
matrix. They remain unavailable until those rows pass.

## Do not ship as desktop-ready until all are true

- The client has a signed, supported desktop package; a browser preview alone
  is insufficient.
- Voice, incoming calls, audio routes and reconnect have real-device evidence.
- Recents, protected recording playback, named speakers, Team Chat and
  notifications have two-account tenant-isolation evidence.
- Accessibility, keyboard behavior, localization, telemetry redaction,
  privacy/retention and support diagnostics have been reviewed on the desktop
  package.
- Desktop video/conference stay hidden or unavailable until their independent
  media tests pass.

