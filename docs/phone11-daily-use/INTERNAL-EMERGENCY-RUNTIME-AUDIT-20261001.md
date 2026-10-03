# Internal/emergency call-history runtime audit — 1 October 2026

**Scope and status:** bounded, read-only inspection of the VoIP host at source
HEAD `11cd1f199cd4cd79d133637ad59271a21014d9e8` (PR #7). This checks the
active path against `INTERNAL-EMERGENCY-OWNERSHIP-DESIGN-20260930.md`; it does
not implement attribution or accept real-call behavior. Access used the
existing operator's temporary EC2 Instance Connect key on instance
`i-0851dd1ea1cfeef71` (`ap-southeast-7a`) with strict host-key checking.
No configuration, service, database, provider, call, or media state was changed.

## Exact observed runtime identities

| Active component | Readback identity |
| --- | --- |
| `p11-kamailio` | image `sha256:f7c3a2412b49f1372c70b2ad06da6f28cb34a044ee3ae408c7b960ef484bb5b7`; `/etc/kamailio/kamailio.cfg` SHA-256 `f4716d3b48e8f59ae863926cc6390f61b8a0d3b67b1732b484b6f7f23fb25d0a` |
| `cp11-api-candidate-wake-local` | image `sha256:6733cf0750e11954be168d7788e6083169c011af9892930337e355e926bf7b75`; container port 3018 bound only to host loopback |
| `p11-freeswitch` | image `sha256:67afd2a5c7d49761b2a534280427f9631529a02da8a4d200afaf817598e2bd14`; `/etc/freeswitch/autoload_configs/xml_curl.conf.xml` SHA-256 `404d486fc46aa44d100d43a4c30507b8231d6ae2d45540cc3225b224043599ce` |

The checked-in Kamailio file hashes to
`1689014d4845a4214b28ae4c33de39de40525f568c07a639226b0da769d28b89`;
the checked-in FreeSWITCH `xml_curl` file hashes to
`6de7e691e237bb9bc9d29c3c1f539c6f593fffee56df4a3cd79f2e9cf729473b`.
Neither checked-in file is the byte-identical deployed file. Runtime behavior
below comes from the container readback, not an inference from those sources.

## Routing and identity boundary

- In the active Kamailio configuration, REGISTER, SUBSCRIBE, PUBLISH, INVITE,
  and MESSAGE call `route(AUTH)`. For every request reaching it, `auth_check`
  runs without the source file's From-domain condition. Only after successful
  digest authentication does it save `$au` and `$ar` to server-side AVPs.
  A narrowly scoped carrier/local-FreeSWITCH pilot INVITE for the configured
  DID is handled before AUTH. This is an ingress exception, not a general
  unauthenticated local or emergency path.
- The initial-INVITE route checks 191/199/1669 first and sends them to
  `TO_FREESWITCH`; the four-digit local-extension branch follows and normally
  uses `lookup("location")` and direct relay, with an unregistered fallback
  to Flexisip. Thus the direct internal path still lacks a FreeSWITCH CDR.
  The active closed-pair local-wake branch is narrower: it requires the
  post-digest account/realm AVPs and sends an HTTP `/offer-local` request to
  the loopback wake sidecar before resume/relay.
- `TO_FREESWITCH` invokes the active outbound-recording identity hook. The
  hook removes client copies of its reserved identity headers and injects
  `$au`/`$ar` derived values only for the configured account, a nine-to-15
  digit PSTN destination, and one valid outbound ID. Emergency short codes
  therefore do not receive that outbound marker. The route then strips SIP
  Authorization headers before forwarding to FreeSWITCH. This inspection
  confirms the Kamailio dispatch and marker boundary; it does **not** prove
  FreeSWITCH gateway selection, provider acceptance, or emergency call success.
- The deployed FreeSWITCH `xml_curl` dialplan binding is commented out and
  names local XML dialplan files. Editing `server/pbx/freeswitch-routes.ts`
  alone cannot capture the active direct internal call path.

## Completion and ownership gap

The closed-pair wake route sends `/terminal-local` asynchronously from BYE,
failure, and cancellation handling, with an HTTP timeout of two seconds and
no observed durable acknowledgement/retry path in the Kamailio route. Its
`ended`/`cancelled` status is wake cleanup, not a general, replay-safe dialog
event stream: it does not cover every local extension, distinct fork/branch
keys, redirect/retry reconciliation, or a transactionally bound owner snapshot.
The sidecar image and loopback binding were identified, but its persistence
contract was not established by this readback. No live endpoint request or
customer-row query was made.

Source at this HEAD still constrains `phone11_recording_routes.direction` to
inbound/outbound, and `server/pbx/cdr-ownership.ts` maps only those two
directions. `server/pbx/personal-call-history.ts` excludes calls without
immutable ownership. The checked-in design remains a proposal: neither a
trusted internal completion ledger nor exactly correlated emergency A-leg
owner marker was demonstrated in this runtime audit. An emergency FreeSWITCH
CDR by itself cannot identify the initiating Phone11 user.

## Next source gate for the lead

The lead's scope decision is to preserve the deployed SIP admission and
routing policy. A failure of optional history attribution must not interrupt a
call permitted by that policy; this does not add an unauthenticated emergency
exception. Use a dedicated history-only ledger so history work cannot enable
audio recording or change the recording-route direction contract. Specify a
protected Kamailio initial-INVITE binding and authenticated durable dialog-event source
with immutable parent-call and per-branch keys, idempotent out-of-order
completion, bounded retry/retention, and an exact emergency A-leg correlation
to FreeSWITCH before implementing or activating that ledger. The dialog-event
source and correlation are still unproven; the existing wake terminal callback
is insufficient. Any later SIP admission change requires its own review.

This audit includes no parser test, SIP transaction, FreeSWITCH CDR sample,
database migration, deployment, provider result, or handset/media test. Those
remain independent acceptance gates after a default-off candidate is built.
