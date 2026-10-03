# Voicemail routing contract v2 (source only)

`PHONE11_VOICEMAIL_HOOK_READY` remains off. No host commissioning, deployment,
provider result or device acceptance follows from these changes.

| Deposit entry | Backend off | Backend on, FreeSWITCH on |
| --- | --- | --- |
| Personal extension after failed bridge | Legacy gateway, original mailbox | Admission hook, allowed bridge failure only |
| Ring-group voicemail fallback | Legacy gateway, original validated target | Fresh tenant/owner/SIP mapping, admission hook after bridge |
| Queue voicemail overflow | Legacy gateway, original target/default 1000 | Fresh mapping, explicit trusted direct-entry admission hook |
| Time-condition voicemail action | Legacy gateway, original domain/target/default 1000 | Fresh mapping, explicit trusted direct-entry admission hook |
| Static internal extension, sales/support and DID fallback, bundled default/Skinny loopback | Legacy gateway, original application order | Refused: static XML has no authenticated personal-mailbox mapping |

The legacy gateway reads the **FreeSWITCH process environment**, and refuses
when its flag is `true`; it never reads a SIP/channel flag. The protected hook
requires the same process flag to be `true`, otherwise it refuses before any
producer call or recording. Thus backend-off/host-on and backend-on/host-off
both refuse dynamic deposits. Other flag values retain backend legacy mode;
the protected hook still refuses unless the host value is exactly `true`.
The static deployment and both infrastructure Compose files receive the
default-false flag via their FreeSWITCH process environments.
Static routes cannot infer a backend flag or trusted owner and must be removed
or kept refused when the host is commissioned. `voicemail check` is mailbox
access, not a deposit, and retains its existing route.

The direct entry argument is a fixed application argument emitted only by the
trusted backend for queue/time-condition routes. It is not a channel variable,
caller identity, or fabricated bridge reason. Both direct and bridge entries
call the same durable producer admission and completion commands. A refusal,
missing private mailbox path, unavailable outbox, failed acknowledgement, or
backend owner-epoch conflict retains the existing producer failure behavior;
no fallback can record an unadmitted inbox deposit. Reassignment after admission
still rejects delayed uploads through the existing owner-epoch contract.

Protected ring-group and queue generators bypass Redis entirely, resolving the
current personal owner, tenant membership, user-extension assignment, active
SIP account with the same owner, and server-selected domain. Ambiguous,
missing, disabled, shared, invalid or reassigned mappings refuse. Protected
routes never infer target 1000. Legacy cache entries containing a prior direct
`mod_voicemail` action are regenerated through the gateway even while the flag
is off. Newly generated legacy cached XML is guarded by the host at execution.

## Release prerequisites

1. Keep both process flags off. Stage this exact reviewed version of
   `deploy/freeswitch/scripts/phone11_legacy_voicemail.lua` at
   `/etc/freeswitch/scripts/phone11_legacy_voicemail.lua`, and
   `infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua` at
   `/etc/freeswitch/scripts/phone11_voicemail_deposit.lua`. Verify installed
   hashes against the release source and runtime read access. Identical copies
   of both helpers are packaged in `deploy/freeswitch/scripts` and
   `infra/configs/freeswitch/scripts`; tests enforce byte parity. Both the
   static scripts mount and the infrastructure full-config mounts include
   both helpers. Their runner/producer/outbox dependencies still require the
   explicit commissioning contract.
2. Verify both helper versions on the exact host before any backend release
   can emit their paths. A missing helper prevents deposits and is not a
   usable flag-off release. Rehearse normal legacy calling/deposit behavior
   and rollback with the flags off.
3. Before eventual commissioning, invalidate already compiled/cached
   FreeSWITCH dialplans from earlier releases and wait for previously admitted
   legacy calls to drain. New source cannot retrofit a guard onto XML already
   held by the host. Redis regeneration alone does not prove host invalidation.
4. Commission the private mailbox roots, fixed runner, durable outbox, backend
   admission/storage schema, relay, final WAV lifecycle and owner-epoch refusal
   under `VOICEMAIL-STORAGE.md`; only then set both process flags exactly true
   under the approved deployment procedure. Rehearse both mismatch directions,
   protected personal/direct deposits, refused static routes and rollback.

Disabling the flag returns guarded legacy deposits. Previously admitted WAVs
and pending/outbox evidence remain subject to the existing retention/replay
contract. No flag change, purge, host restart or deployment is authorized by
this source document.
