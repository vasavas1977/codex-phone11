# Phone11 handset follow-up — 20 September 2026

## User reports and acceptance boundaries

- Build 74: Join meeting shows a generic retry error. The native manual-audio
  session was started after room connection; source fixes reverse that order and
  release partially activated audio on failure. A signed Build 75 conference-only
  candidate exists, but successful handset media after the fix is not proven.
- Typing `@` did not open member suggestions. The corrected composer uses the
  caret, filters current conversation members, preserves verified IDs/ranges,
  and restores typing focus. The light/dark browser preview passed at 390×844,
  including English and Thai queries. Physical iPhone keyboard testing remains.
- 1020 had no ordinary notification registration. Protected read-only checks
  found both API/worker notification gates and APNs configuration healthy, no
  conversation mute, and zero device rows. After the owner's enable action,
  fresh checks found one eligible device. This proves enrollment, not delivery.
- Standby expired the 90-second active presence lease. The new source separates
  active activity from valid, bounded mobile notification reachability; revoked
  sessions, inactive memberships, invalid tokens, and stale enrollments must not
  keep a user online.

## Requested profile behavior

Use a compact profile hub with Availability, Status and Work location rows.
Each opens its own picker/editor. Availability supports Available, Away, Busy,
Out of office, timed Do not disturb and Reset. Status supports text and expiry;
work location supports Office, Remote and Off. Persist preferences within the
selected workspace. Keep assigned telephone/account information read-only.

Do not fabricate Zoom licensing, personal meeting IDs, profile photos or QR
destinations. Use actual Phone11 identity and supported account capabilities.

## Delivery requirements

- Preserve existing SIP calling, wake delivery and the signed daily-pilot app.
- The installed runtime has OTA disabled; client changes need a signed build.
- Review/apply new profile and mention schema before enabling their APIs.
- DND requires updated notification dispatch revalidation as well as API enqueue.
  Updating only the API candidate is insufficient while an older worker sends
  queued alerts.
- Keep source tests, schema/API deployment, signed-package verification and
  physical two-iPhone acceptance separate. Never label all complete from a
  token-mint probe or browser-only preview.

## Official references

- [Zoom mentions](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064557)
- [Zoom availability](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065488)
- [Zoom status messages](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066608)

## Next signed-build acceptance

1. Install from the verified EAS build-details page on both enrolled iPhones.
   Keep the working app and account provisioning; do not uninstall it.
2. From 3001, send one Team Chat message to locked 1020. Verify the alert
   appears and opens the correct workspace/conversation after authentication.
3. Keep 1020 signed in but backgrounded. Verify the colleague badge shows mobile
   availability; sign out and confirm it no longer claims availability.
4. Type `@` in a channel, filter by English/Thai name, choose a member, send, and
   check the received mention. Only authorized group/channel administrators
   should see `@all`; ordinary members must also be rejected by the server.
5. Open My profile. Check availability, timed Do not disturb, status expiry,
   and work location survive app reopening and remain workspace-scoped.
6. While Do not disturb is active, send a message from the second phone and
   verify ordinary message alerts are suppressed. Repeat after reset/expiry.
7. Join the admitted meeting on both phones. Verify camera, two-way audio,
   mute, camera toggle, leaving and rejoining. Then place a normal SIP call
   to verify meeting audio cleanup preserved calling.

A passed source test or registration check does not complete these handset
steps. The owner has not yet reported locked-screen message-alert delivery.
