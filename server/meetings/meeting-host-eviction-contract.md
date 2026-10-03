# Host participant removal source contract

`createMeetingHostEvictionService` is unmounted and disabled by default. A join
configuration or `capabilities.available` does not enable removal. Future
composition must explicitly inject reviewed, isolated per-tenant eviction
clients after confirming the Connect11 eviction scope, activation, namespace,
cloud revocation and durable-store gates. This source adds no environment
configuration, RPC route, UI or provider activation.

Only the original creator of a channel/direct-origin meeting may remove another
member. Each request and poll rechecks current tenant, identity, admission,
channel/direct membership, extension and host-start permission. Direct meetings
also require the exact unblocked pair. Legacy rooms have no authoritative host.
Clients supply a tenant, room UUID and target user ID; provider room/member
identity and idempotency key are resolved from durable server state.

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
