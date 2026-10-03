# Ordinary Team Chat notification candidate

This is a source-only addition after build 24. It has not been deployed, enrolled,
provider-tested or accepted on a physical recipient. Existing VoIP registry,
PushKit wake grants and call delivery are unchanged. Text never uses a VoIP token,
`.voip` APNs topic, CallKit or SIP wake.

## Behavior and privacy

- A separately stored ordinary APNs device token belongs to an authenticated
  session, user and selected Team workspace. The owner is derived from auth; fresh
  assignment checks authorize enrollment. Switching workspace enrolls that
  selected workspace, not every workspace. A provider token is not retained for a
  previous owner/session. Logout deletes its auth session and cascades these rows.
- Only new committed messages enqueue recipient-device outbox rows; message retry
  IDs cannot fan out twice. The sender is excluded. Both insertion and the message
  commit share one database transaction. No provider work occurs in the send API.
- Workers recheck live session/identity, workspace assignment, conversation
  membership, unread sequence, device revision and expiry before delivery. They
  mark an attempt durably before network work. Attempts that crash, time out or
  receive an uncertain response are never replayed. This chooses possible missed
  alerts over duplicate alerts; it is not guaranteed or exactly-once delivery.
- Ordinary requests use `apns-push-type: alert`, the plain app topic and an expiry
  no later than the outbox's ten-minute deadline. VoIP retains expiration zero.
  The payload is only generic “Phone11 / New message” text and an opaque event ID.
  No sender, message text, workspace identifier, conversation ID or credentials
  enter the payload. Provider acceptance is not recipient receipt.
- Notification taps resolve that event through the current authenticated session
  and fresh membership checks. Expired, revoked or unavailable events show generic
  guidance to open Team Chat. Payload routes are ignored. Cold/inactive taps retain
  only the opaque ID until auth/foreground readiness; owner changes invalidate
  pending work. Duplicate callbacks and superseded taps cannot route twice.
- Enrollment observes existing permission on launch. Asking for permission requires
  an explicit in-app action. Denial, server unavailability and session changes have
  distinct truthful outcomes. After the permission dialog resolves, native-token and
  enrollment work shares a fifteen-second deadline; late completion cannot bind a
  replacement session or report false success. Unmount removes listeners; default-off does no token,
  permission or listener work. Transient enrollment failures retry only for the
  same active account and workspace, backing off to once a minute without permission
  prompts. Denied permission, unavailable configuration and authorization failures
  do not retry. Native token events are consumed and deduplicated without calling
  the token getter recursively. Tokens are not logged or persisted in the mobile
  app; a non-secret local grouping ID uses device-only SecureStore.

## Separate deployment and commissioning

Do not append this migration to the earlier frozen call-push/wake rollout.
`migration.sql` creates only `phone11_chat_notification_devices` and
`phone11_chat_notification_outbox`, requiring the existing owned-auth and chat
schema. Before any future application, use a complete backup/restore rehearsal,
exact schema review and a separately approved backend artifact.

Default server gate `PHONE11_CHAT_NOTIFICATIONS_ENABLED` is off. The independent
mobile `PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED` flag also defaults off and must
use the approved production APNs environment/profile. Keep both off until the
new schema, provider and native app prerequisites have been commissioned. The
mobile root component and explicit permission action are separately wired in the
application; no legacy demo notification store is used.

Enable only after schema verification. Enabling before migration makes the atomic
outbox insertion fail and the message transaction roll back; it must not be used
as a missing-schema fallback. Missing/invalid provider configuration after a
message commits leaves its message intact and marks its notification attempt
unavailable; it does not cause message retries. Missing providers are never mock
success. Database lock/statement timeouts bound notification repository work.
A metadata cleanup removes expired outbox rows after one day; revoked auth
sessions cascade their device/event rows immediately.

Required physical acceptance: ordinary-token enrollment, actual separate recipient
message, background/locked alert, generic lock-screen text, tap to the authorized
conversation, duplicates, expired event, logout/account/workspace changes, permission
denial, and brief network loss. No ordinary chat alert or native wake success is
claimed before these tests. The selected-workspace scope and bounded at-most-one
attempt policy must remain explicit.

## Verification

`node scripts/test-phone11-chat-notifications.mjs` starts a disposable PostgreSQL
cluster on a private Unix socket, applies the existing chat plus new schema,
runs the dedicated regression suite and removes the cluster. CI uses its own
`phone11_chat_notification_test` database via
`PHONE11_CHAT_NOTIFICATION_TEST_DATABASE_URL`; the test rejects non-loopback or
wrong-database targets. It never connects to the live Phone11 database.

Focused tests cover client identity/lifecycle/tap ordering, actual mounted observer
cleanup, protected router gate/session binding, generic APNs headers/expiry and
no uncertain replay. Real PostgreSQL tests exercise atomicity, concurrent retries
and claims, session/assignment/membership revocation, stale APNs410 cleanup,
provider-tuple changes, missing schema/provider handling and bounded lock waits.
The pre-existing VoIP transport tests must also continue to pass.
