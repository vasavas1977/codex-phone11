# Phone11 presence: product decisions and acceptance

Research checked 20 September 2026. This document describes the requested behavior, not a deployment claim.

## Reference

Zoom's official [presence guide](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065488) distinguishes availability, device availability, offline, call and meeting activity, presenting, and manual availability settings. Manual settings synchronize across signed-in devices. Its Do not disturb mode affects notifications and calls; a cosmetic label alone would not match that behavior.

## Phone11 decisions

- Use an accessible status icon on teammate avatars, with a short label in conversation headers and contact details. Keep message bubbles unchanged.
- Derive Available, Away, Offline, On a call and In a meeting from actual account-owned app/call/meeting activity. Do not use the old simulated SIP presence engine.
- A meeting invitation, admission token, or prejoin screen is not an active meeting. A connected or temporarily reconnecting session is.
- Keep device sessions separate, with server-clock expiry. An idle phone must not clear a call on another device. Failed requests, app termination, logout and tenant changes must not leave a permanent busy indicator.
- Presence is restricted to authorized active workspace colleagues. Return status only; never expose the other call party, phone number, meeting title, room, token or participants.
- Unknown or failed presence queries must not be presented as confirmed Offline. A fresh offline determination requires a successful server response.
- Manual availability, DND, calendar events and screen-sharing states may only be exposed when their actual behavior is implemented. Preserve existing calling and notification policy.

## Acceptance on two iPhones

1. Install the same accepted signed build on 3001 and 1020. Open Phone11 on both: each sees the other's current availability.
2. Move to another Phone11 tab: availability remains current. Background and return: activity transitions and recovers without reopening Team Chat.
3. Start and end an app-to-app call: both teammates' statuses change and clear. Repeat with one phone on mobile data and with a locked recipient; existing ringing and two-way audio must still work.
4. Once the admitted conference pilot is enabled, join from both accounts: In a meeting appears only after connection, stays correct through a brief reconnect, and clears on leave or SIP interruption.
5. Force-close/disconnect one phone: its lease expires. Open a second session for the same account: closing the idle session must not clear the active session.
6. Switch account/workspace and suspend a test membership: no previous workspace's status is published or visible.

Source tests, deployment, and these handset checks are separate acceptance layers. Build73 contains the voice repair, not this new presence implementation.
