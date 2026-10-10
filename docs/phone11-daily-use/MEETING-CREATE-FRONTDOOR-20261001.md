# Meeting creation from Meetings — 1 October 2026

## Source behavior

Mobile and web Meetings now offer **New meeting** for the signed-in owner of
the selected Team Chat workspace. The action is reachable before the owner has
an admitted room: the general meeting capability checks room admission, while
creation uses the separate protected channel hosting capability.

The create screen refreshes the existing workspace conversation list and shows
channel and group choices. Selecting a channel loads its protected current
member roster and hosting capability. The existing `ChannelMeetingPicker`
selects all invitees by default, supports deselection and search, identifies
the host, and enforces the returned participant limit. Loading, failed roster,
permission denial and unavailable hosting states keep Start disabled.

Submitting rechecks hosting, then calls the existing
`meetings.startChannelMeeting` through the authenticated chat transport. The
existing server owns room creation, current tenant/member/extension/identity
authorization, durable admissions and internal recipient invitations. This
source slice adds no database, provider, calendar or delivery implementation.
After a valid acknowledgement, it opens the exact returned room and tenant in
the existing prejoin flow. It does not start microphone or camera capture.

Only one submission runs at a time. An uncertain creation response keeps the
server-supported request ID and original selection in memory for explicit
retry, including closing and reopening the selector during the same mounted
screen. A changed selection is refused while that uncertain request exists.
The server's host/channel/selection replay contract recovers the original room;
there is no automatic creation retry. Leaving the create screen or restarting
the app ends this in-memory recovery context; existing admitted meetings remain
the recovery path for a room that was created before interruption.

Session, workspace, channel and focus checks discard stale reads and creation
acknowledgements. Cancel and Back are available before submission; submission
locks the screen's navigation and selection actions until the request settles.
The shared picker, existing chat screen, server authorization and meeting/SIP
media lifecycle are unchanged.

## Benchmark and boundaries

Zoom's current [host start/join workflow](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061821)
provides meeting entry points on desktop, mobile and web. Its
[invitation workflow](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063688)
includes contact selection and shared invitations. Phone11 reuses its existing
authorized workspace conversation invitations for this bounded entry point.

General scheduling remains blocked by the shared Calendar/Tasks service's
missing authenticated API, durable operation ledger and identity mapping in
this checkout. The [shared calendar decision](SHARED-CALENDAR-PHONE11-ADAPTER-20260916.md)
keeps Super Number as the canonical event/task store. Full scheduling,
moderation, guest links, email delivery and push delivery are not completed by
this slice. Direct-contact Meet now continues through the existing direct chat
action and desktop chooser.

## Local validation

- TypeScript `--noEmit` passed before the final documentation-only update.
- 113 tests across the new creator, conference session races, existing picker,
  direct action, chat controls, authenticated transport, prejoin and channel
  meeting service passed. No environment-gated tests were included in this run.
- The 35 new creator tests cover scope changes, cancellation, loading/failure,
  permission revocation, invalid selections, exact acknowledgement validation,
  duplicate taps and request recovery. The existing picker suite verifies its
  default participant selection and host exclusion.
- Focused ESLint and `git diff --check` passed. Source checks
  do not establish signed-client visual behavior, recipient delivery,
  two-device media, hosted schema or provider acceptance.

No database migration, hosted write, provider operation, message delivery,
app build/release or deployment was performed. Independent source review and
the coordinated signed-client invitation/media acceptance remain required.
