# Phone11 and Super Number shared task service review — 15 September 2026

## Decision checkpoint

Do not replace Phone11's private call follow-up storage or add a provider adapter yet. The reviewed Super Number checkout defines and tests a pure canonical-task contract, but it does not implement the single persisted task service, offline operation queue, reconciliation workers, account mapping, or Phone11 and Zoom Phone adapters.

Recommended ownership:

- **Shared task foundation / Super Number owner:** versioned canonical contract, server-side ID generation, task repository and API, durable operation ledger, conflict records, tombstones, authorization, principal/account mapping, and adapter interface.
- **Phone11 owner:** a separate `Phone11TaskAdapter` that converts an authenticated Phone11 call follow-up into the shared contract, owns its local offline outbox, and keeps recording-derived tasks in a personal silo unless the owner explicitly shares one.
- **Super Number Zoom integration owner:** a separate `ZoomPhoneTaskAdapter` for Zoom account binding, Zoom tenant mapping, provider identifiers, webhook/delta reconciliation, and Zoom-specific source backlinks.

No shared task code was changed during this review.

## Sources reviewed

- Super Number checkout: `work/calendar-tasks-design-20260915`
- Branch: `feat/calendar-tasks-design-20260915`
- Exact source: `bf1e7e113857b1fe372fd0fb001026f6a9e3ec40`
- Contract: `src/lib/supernumber-ui/calendar-task-contract.ts`
- Design: `docs/supernumber-v7.9/CALENDAR-TASKS-ORCHESTRATION-DESIGN.md`
- Contract tests: `tools/supernumber-ui/calendar-task-contract.test.mjs`

The Super Number implementation register explicitly says Phone11 is outside that work. The checkout's upstream branch is also gone, so the shared owner must confirm its canonical integration branch before implementation.

## Current Phone11 task behavior

Phone11 currently stores one optional task inside personal recording metadata:

- fields are only `text` and `completed`;
- storage is local AsyncStorage scoped by authenticated numeric user ID and call UUID;
- account changes invalidate the active view and prevent a stale write from being treated as current;
- writes are ordered on the device and roll the visible value back when persistence fails;
- the UI states that the task stays private on the device with the call.

This is a useful privacy-preserving local feature. It is not a synchronized task:

- there is no standalone stable task ID;
- there is no tenant, personal realm, or workspace mapping;
- there is no due time, planned time, reschedule operation, or independent task list;
- completion is a local boolean toggle without a version or idempotent operation ID;
- there is no durable offline outbox, acknowledgement, retry watermark, conflict record, or server reconciliation;
- there is no explicit share operation.

Phone11 must keep this existing data readable while a future adapter migrates it lazily. The adapter must never upload the existing local item merely because the user signs into an employer workspace.

## Useful parts of the proposed shared contract

The reviewed contract provides a sound starting shape:

- immutable canonical task and source IDs across mutations;
- exact tenant, workspace, and owner context checks;
- a trusted source-authorization object at creation;
- `expectedVersion` optimistic concurrency;
- idempotent mutation retries through `operationId`;
- separate deadline and planned-work time;
- explicit complete, reschedule, and unschedule operations;
- provider bindings without access tokens;
- explicit Google Tasks date-only loss and Microsoft To Do date-time capability.

All 17 contract tests pass. No production service imports the contract.

## Contract conflicts to resolve first

| Area              | Proposed contract                                                       | Phone11/shared requirement                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility        | `personal` or `workspace`                                               | The product design also promises shared-with-assignees. Define principals and permissions before exposing sharing.                                                                          |
| Private tenant    | Personal tasks require `workspaceId: null` but still require `tenantId` | Define a server-owned personal realm that employer administrators cannot query. Never reuse an employer tenant as the personal silo.                                                        |
| Sharing           | Privacy is fixed at creation and there is no share command              | Explicit sharing should create a separately scoped workspace task with a new canonical ID and an auditable owner decision. It must not flip the private record in place.                    |
| Identity          | IDs are caller-supplied strings                                         | The shared service must generate globally unique canonical IDs and reject conflicting creation retries by operation ID plus request digest.                                                 |
| Source identity   | Generic `phone` and `/app/calls/{sourceId}`                             | Add an explicit Phone11 source system or require a collision-safe namespace. A Phone11 call and Zoom Phone call must never resolve to the same backlink accidentally.                       |
| Account mapping   | `accountBindingId` is opaque                                            | Resolve Phone11 account, Zoom account, canonical user, personal realm, tenant, and workspace through an active server-owned mapping. Client fields are claims, not authority.               |
| Completion        | Completion is irreversible and later edits are rejected                 | Phone11 currently toggles complete/incomplete. Decide and model an explicit reopen operation, or remove the toggle before migration.                                                        |
| Offline retry     | Only 64 operation IDs are retained inside a task                        | Use a durable operation ledger with operation ID, request digest, client/device ID, acknowledgement, and safe retention. A task must not become permanently uneditable after 64 operations. |
| Conflict handling | A version conflict returns only the current task                        | Retain the submitted competing values in a conflict envelope so the user can choose; do not silently discard an offline edit.                                                               |
| Replica lifecycle | Bindings can be added but not advanced or removed                       | Add revision advancement, reconciliation outcome, detach/remove, cursor, origin, and remote deletion semantics.                                                                             |
| Deletion          | Only unschedule exists                                                  | Add task tombstones and distinct delete-task, remove-external-copy, and unschedule operations.                                                                                              |

## Phone11 adapter contract proposal

The Phone11 adapter should be a small boundary around the shared service, not a copy of its reducer. Its input must come from a fresh authenticated Phone11 session and a server-authorized call source.

Minimum identity mapping:

```text
Phone11 account ID
  -> canonical user ID
  -> personal realm ID
  -> optional active workspace membership IDs

Phone11 call UUID + recording owner ID
  -> authorized source reference
  -> canonical private task ID, when created
```

The server must derive every right-hand value. A client-supplied tenant or workspace ID cannot grant access.

Create flow:

1. Keep the task local while the user edits it.
2. On an explicit **Save to Tasks** action, generate one durable client operation ID and enqueue it locally before sending.
3. The adapter resolves the current Phone11 account to the canonical user and personal realm.
4. It proves that the account may read the exact call/recording UUID.
5. It creates a `personal` task with `workspaceId: null`; server-generated canonical ID is returned and stored beside the local call metadata.
6. The same operation may be retried after an uncertain or offline result. The operation ID and request digest must return the same result.

Update flow:

1. Queue complete, reopen, due-date, reschedule, and unschedule operations with the last accepted version.
2. Send in order for that task while permitting unrelated tasks to synchronize independently.
3. On success, save the returned version and acknowledgement before removing the outbox item.
4. On version conflict, retain both local intent and remote state and show a resolution choice.
5. On account change, stop the queue and hide the previous account's state before loading the next account.

Share flow:

1. Sharing is a separate owner action that names the destination workspace and intended assignees/visibility.
2. The server revalidates active membership and source-sharing policy.
3. Create a new workspace task ID derived from a redacted task draft. Do not move or relabel the private task.
4. Do not expose the private recording, transcript, summary, backlink, or personal notes unless each item is explicitly included and the destination may read it.
5. Record an audit event visible to the owner and workspace administrators within their allowed scope.

## Acceptance before implementation

The shared owner and Phone11 owner should approve these contract decisions first:

1. canonical task ID and create-idempotency authority;
2. personal realm isolation and explicit account/tenant/workspace mapping;
3. assignee/shared visibility model;
4. private-to-workspace copy/share semantics;
5. complete versus reopen behavior;
6. offline operation ledger, acknowledgement, retention, and conflict envelope;
7. source-system namespacing and safe backlinks;
8. replica revision, detach, deletion, and tombstone lifecycle;
9. versioned adapter interface for separate Phone11 and Zoom Phone implementations;
10. lazy migration and rollback for existing Phone11 local tasks.

After that checkpoint, implement the shared contract and service in its canonical repository first. Phone11 should then implement only its adapter, local outbox, migration, and UI states against the pinned contract version. Zoom Phone should use its own adapter and must not share Phone11 credentials, source identifiers, or privacy defaults.

## Continuation: Phone11 durable queue foundation

After the owner's instruction to continue, Phone11 added
`lib/tasks/durable-outbox.ts` and its focused tests. This is a device persistence
component behind injected storage, command validation, and transport. It is not
connected to the recording UI or any live endpoint and does not implement a
second canonical task service.

The queue persists intent before transmission, snapshots mutable inputs,
compares retries independent of property order, preserves original IDs after
uncertain responses, and removes only a matching acknowledged operation after
storage succeeds. Conflicts retain intent and block later edits for that task;
unrelated tasks may continue. Storage corruption fails closed without erasing
pending work. Account keys must include the server/account namespace.

Integration must provide one queue instance per account/storage key and an
`isCurrentSession` callback bound to a login-session generation, not just the
current numeric user ID. Call `stop()` on logout or account replacement. The
injected validator must enforce the full pinned shared contract and scope.
The transport must bind credentials to the captured login session, rather than
reading whichever account is current when sending. The server must revalidate
mapping, source ownership, current permissions and
idempotency. The queue does not grant permission or supply a share action.
No existing private recording task is automatically imported.

### Newly discovered shared work

Read-only parallel review found a newer `work/phone11-sync-contracts-20260915`
checkout. Its latest committed boundary is `5ed5e83`; further defensive-copy
changes remain uncommitted and owned by the shared project.
It provides explicit Phone11/Zoom bindings, server-call projection, private
import preparation and `Phone11CanonicalTaskAdapter.create/mutate`.
`work/calendar-task-contracts-20260915` at `d35b07f` still uses the older canonical
contract. No mutable shared file was copied or changed by Phone11.

The shared owner must resolve these demonstrated mismatches before integration:

- Dotted conversation IDs pass sync preparation but fail canonical creation.
- Dates outside 2000–2099 pass sync preparation but fail canonical creation.
- The shared in-memory enqueue helper retains mutable nested command references.
- Its retry equality depends on object-property insertion order.
- Completed legacy tasks need explicit handling: their completion time is unknown,
  while canonical creation starts incomplete.

The committed shared boundary passes its 34 canonical and Phone11 contract tests,
but it does not provide a database repository, authenticated API endpoint, durable
server operation ledger, replay worker, or reconciliation service. Phone11 must
not expose synchronization as available until that server path exists.

Shared service, personal realm mapping, reopen, durable operation ledger,
conflict resolution, tombstones and explicit workspace sharing remain pending.
Phone11 can wire its queue only after the shared transport and contract version
are pinned; Zoom Phone retains a separate adapter.

Validation: 8 queue tests and 2 existing private metadata tests pass. Standalone
strict TypeScript, focused ESLint and whitespace checks pass. These establish
local component behavior, not handset or cross-app synchronization acceptance.
