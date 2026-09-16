# Phone11 shared Calendar and Tasks adapter — 16 September 2026

## Decision

Phone11 uses the Super Number Calendar and Tasks service as its only shared
source of truth. Phone11 does not create a second event store, task ID scheme,
or provider integration. Its role is a phone-aware client and adapter for:

- scheduled calls, callbacks and meeting hand-off;
- call-derived workspace tasks after an explicit user action; and
- an owner-private recording follow-up that remains private unless separately
  shared by its owner.

Phone11 may show an agenda or upcoming-calls view, but it is a projection of
the shared service. Calendar-provider connections, free/busy, invitations and
external writes remain Super Number responsibilities.

## Pinned integration candidate

Use the following pair together for static adapter work:

- Super Number checkout `work/phone11-sync-contracts-20260915`, branch
  `feat/phone11-sync-contracts-20260915`, commit
  `1394bae9ad0c8a4f7cce53ac11eb5b6569580bc0`.
- `src/lib/supernumber-ui/calendar-task-contract.ts`, introduced by
  `32c332e820f7b11c734888509d3c7748b3dc2f29`, and
  `src/lib/supernumber-ui/phone11-sync-contract.ts` at the same candidate
  head.

This is a **provider-inert contract candidate**, not an activated service
version. The candidate tests canonical task creation/mutation and Phone11
identity/call preparation, but it has no authenticated repository, persistent
operation ledger, API, reconciliation worker or deployed Calendar/Tasks
service. Phone11 must continue to describe shared sync as unavailable until
those components are available at one confirmed Super Number revision.

## Ownership and data boundaries

| Concern | Owner | Phone11 behavior |
| --- | --- | --- |
| Canonical task IDs, versioning, conflict records and tombstones | Super Number | Stores only returned IDs and versions. It never generates a replacement canonical ID. |
| Account, personal-realm, tenant and workspace mapping | Super Number server | Sends no client claim as authority; stops its outbox when the Phone11 session changes. |
| Google/Microsoft calendars, free/busy, invitations and provider replicas | Super Number | Opens a shared-calendar projection or hand-off; no Phone11 OAuth or provider write path. |
| Call/callback task draft and device outbox | Phone11 | Saves only after an explicit user action; keeps unrelated task queues independent. |
| Recording-derived follow-up | Phone11 owner | Remains personal and local until an explicit owner-confirmed import and separate share decision. |
| Zoom Phone | Separate Super Number adapter | Must not share Phone11 provider bindings, call identifiers, credentials or privacy defaults. |

## Required Phone11 mapping

The Super Number server resolves, from the current authenticated Phone11
session, this chain:

```text
Phone11 account + tenant + user + extension
  -> active, versioned Phone11 identity binding
  -> canonical Super Number user and workspace or personal realm
  -> authorized canonical call/conversation source
```

For a workspace task, the candidate contract requires an active Phone11
provider binding with `call_history`, an exact identity-binding version and a
server-authorized canonical conversation ID. A local call UUID, device wake
ID, or a raw provider number cannot become a shared source backlink.

For a private follow-up, the task uses the owner's personal realm with
`workspaceId: null`. Import is opt-in and keeps the legacy completion flag as
unresolved history; it must not invent a completion timestamp. Sharing creates
a redacted workspace copy with a new canonical task ID. It never changes the
private task's scope in place or exposes a recording, transcript, summary,
notes or backlink by implication.

## User experience for Phone11

Keep Phone11 minimal:

1. **Recents / call detail:** `Create follow-up` creates a private local draft.
   `Save to shared tasks` is available only after the server reports an active
   mapped workspace and an authorized source. The UI shows `Sync unavailable`
   until then.
2. **Phone tab:** show a compact **Upcoming** section for the next shared
   scheduled call or meeting. Selecting it opens the shared event/task; it
   does not copy the event into Phone11 storage.
3. **Schedule callback:** opens a shared task/event hand-off with deadline and
   planned time kept separate. If no shared service is available, retain the
   private draft and do not promise calendar sync.
4. **Calendar and provider settings:** remain in Super Number. Phone11 links
   there rather than adding calendar-account selection, OAuth scopes or a
   duplicate full calendar screen.

## Offline and conflict rules

Phone11's `Phone11TaskOutbox` remains a device queue only. Once the service is
pinned, each command carries one stable operation ID, canonical task ID and
last accepted version. The client persists the command before sending and
removes it only after the matching server acknowledgement has been durably
stored. A conflict keeps both the local intent and returned remote task for a
user choice; the client never silently replays against a new version.

The current durable queue cannot be wired yet because its lightweight
`accepted/conflict/retry` reply differs from the candidate's canonical
`created/applied/duplicate/rejected` results and there is no server operation
ledger. Do not translate those results client-side or add a fallback local
"shared" task store.

## Integration gates

Before exposing a shared Calendar or Tasks control in Phone11, the Super
Number owner must supply all of the following at one pinned revision:

1. authenticated task repository and transport with server-generated IDs;
2. durable idempotency ledger, conflict envelope, reopen and tombstone rules;
3. active account/personal-realm/tenant/workspace mapping and revocation tests;
4. source authorization for the exact Phone11 call or recording;
5. a contract decision on source namespacing so Phone11 and Zoom Phone cannot
   collide under the generic `phone` source system;
6. explicit private-to-workspace copy/share semantics and audit records; and
7. synthetic offline, reconnect, completion, reschedule and account-change
   acceptance tests across both apps.

Only then should Phone11 replace its local follow-up flow with the
`Phone11CanonicalTaskAdapter`, render shared Upcoming items, or advertise
Calendar synchronization.

## Verification

At the pinned candidate revision, the canonical contract suite passed 18 tests
and the Phone11 adapter-contract suite passed 27 tests. This is contract-level
evidence only; it is not an authenticated cross-app sync, provider-calendar,
handset or customer-data acceptance result.
