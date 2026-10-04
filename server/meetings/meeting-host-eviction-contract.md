# Host participant removal source contract

`createMeetingHostEvictionService` is disabled by default. A join
configuration or `capabilities.available` does not enable removal. Future
composition must explicitly inject reviewed, isolated per-tenant eviction
clients after confirming the Connect11 eviction scope, activation, namespace,
cloud revocation and durable-store gates. This source adds no environment
configuration or provider activation. Protected `hostControls`, `removeMember`
and `removalStatus` routes compose the existing service only through the explicit
reviewed dependency seam. The normal exported router supplies no gate, so these
routes make no DB/provider calls and disclose no admitted member names by default.

Only the original creator of a channel/direct-origin meeting may remove another
member. Each request and poll rechecks current tenant, identity, admission,
channel/direct membership, extension and host-start permission. Direct meetings
also require the exact unblocked pair. Legacy rooms have no authoritative host.
Clients supply a tenant, room UUID and target user ID; provider room/member
identity and idempotency key are resolved from durable server state.
The RPC additionally requires the current server snapshot's opaque
`expectedParticipantId`, `expectedRoomRevision` and `expectedMemberRevision`
assertions. An initial revocation compares all three with the locked exact
admission. They never override provider coordinates. The durable operation key
binds the room revision as well as tenant, meeting and participant. The local
revocation writes the preallocated operation UUID as the member revision.
Replay/poll requires a currently revoked member bearing that exact operation
UUID and the current room-bound key. This permits the original uncertain request
to reconcile its own denial despite changing the initiating member revision;
the response also supplies the post-denial assertion for later poll/retry.
A changed room lifetime, readmitted member, unrelated denial or legacy unbound
operation is refused and hidden, including with fresh caller assertions. Legacy
local denial remains in force; this source performs no migration or rewrite.

Authorization and the existing local member/lease revocation commit together
before external I/O. Existing exact eviction operations permit replay of that
locally revoked target; unrelated revocations are refused. Concurrent requests
share the operation and in-process provider request. Unknown POST outcomes retain
the exact durable key/body for replay. Poll selects the stored provider UUID.

`pending` and `processing` acknowledge no removal. `processing` remains locally
pending and is retained as fresh `providerState` metadata. An uncertain POST
returns durable pending with `providerError: unavailable`. Only a validated
completed receipt confirms provider acknowledgement; it does not prove handset
removal. Local revocation persists through provider failure. End-for-all, mute,
unmute, waiting-room management, re-admission and host transfer are unsupported.

`hostControls` accepts only a meeting UUID and derives the tenant from the
original creator record. Its bounded snapshot rechecks current creator, tenant,
identity, host-start permission, admission and channel/direct membership, including
another host check after member loading. Member names are presentation only.
Exact locally revoked operations remain visible for status/retry; unrelated
revocations remain hidden. This is an admitted-access snapshot, not a list of
current media connections or a claim of physical departure.

The shared browser/iOS/Android room offers confirmed permanent access removal,
an explicit status check and idempotent uncertain retry. It uses fresh direct
authenticated queries, exact owner-object/room/loaded-row fences and Leave epochs. Connection loss
permanently retires the initiating controller even if reconnection occurs before
React renders; a refreshed room revision cannot inherit its controls.
Errors clear authority rather than restoring admitted rows; a known denied subject
cannot return to admitted under the same membership assertion. The media roster
is updated only by actual session events. Avatars reuse trusted workspace
descriptors only on an exact authoritative tenant/user match, with initials
otherwise; no HMAC identity or display-name matching is invented.

Desktop wiring is deferred. Disposable PostgreSQL snapshot/revocation regressions
must run with zero skips in the existing hosted lane; source/mock/consumer tests
do not establish database, provider activation, native media or device acceptance.
