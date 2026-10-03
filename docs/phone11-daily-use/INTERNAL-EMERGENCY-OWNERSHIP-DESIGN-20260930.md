# Internal and emergency call-history ownership: active-path handoff

**Status: design only.** No internal/emergency ownership capture, Kamailio
event ingestion, database migration, runtime configuration, or handset release
is implemented by this document. Personal history already excludes calls
without immutable ownership (`server/pbx/personal-call-history.ts`). Keep that
fail-closed behavior until real-call evidence establishes this design.

## Observed source path and trust boundary

`infra/configs/kamailio/kamailio.cfg` runs `route(AUTH)` before an initial
INVITE. Its `auth_check` applies to REGISTER or a request whose From URI is
local; other ingress can pass without that digest check. The four-digit local
branch uses `lookup(location)` and relays directly, including its wake path.
Ordinary internal calls therefore do not enter FreeSWITCH or produce a
FreeSWITCH XML CDR. The emergency branch sends 191/199/1669 to FreeSWITCH
before that local-extension branch. Emergency ingress must remain routable
without a Phone11 user identity.

The checked-in FreeSWITCH `xml_curl` dialplan binding is disabled
(`infra/configs/freeswitch/autoload_configs/xml_curl.conf.xml`). Editing
`server/pbx/freeswitch-routes.ts` would miss the active internal path. The
candidate outbound hook in
`infra/configs/kamailio/phone11-outbound-recording-candidate/routes.inc`
shows the useful boundary: remove all client-supplied identity headers, then
inject identity from `$au`/`$ar` saved only **after** successful digest auth.
That hook is scoped to one ordinary PSTN account; its README explicitly
excludes internal and emergency calls. Neither From/domain, caller ID, a
client-supplied tenant/user/channel variable, nor the `variable_tenant_id`
fallback in `server/pbx/fs-event-listener.ts` proves ownership.

FreeSWITCH's authenticated ESL/channel-dump capture
(`server/cloud-recordings/capture-service.ts`) currently accepts only the
bounded outbound marker or an inbound wake link. The persisted
`phone11_recording_routes` direction constraint in
`server/cloud-recordings/migration.sql` permits inbound/outbound only.
`server/pbx/cdr-processor.ts` derives caller/callee user IDs from a trusted
persisted route, while `server/pbx/cdr-ownership.ts` maps only inbound/outbound.
The generic FreeSWITCH CDR may complete an emergency call, but does not by
itself prove which user placed it. The direct local call has no FreeSWITCH CDR
to complete.

## Minimal active-path candidate

At initial INVITE, a reviewed Kamailio hook should first erase every client
copy of reserved ownership headers. Only after the existing digest check
actually succeeds should it preserve the authenticated account and realm as
server-owned request state. The current `route(AUTH)` condition means a local
extension request that did not meet that condition has **no proven digest
identity**, even if its From domain looks local. Do not treat it as an owned
call or silently change SIP admission. Audit the deployed config and each
ingress class before choosing where this hook runs.

For an eligible call, a server-side initiation binder must resolve exactly one
active SIP account, active tenant, same-tenant active extension, current user
assignment, and active tenant membership in one protected transaction. It
must bind the authenticated account to the call's exact signaling identity;
the callee of an internal call may receive an owner snapshot only after an
equally exact same-tenant destination/assignment check. An unowned or shared
destination must not be attributed by number. Snapshot validated user IDs,
tenant, extension IDs, direction and correlation before routing; later
reassignment must not transfer that history. Repeated initiation must accept
only the exact same binding. Conflicting channel, tenant, authenticated
account, destination or owner claims fail closed for attribution.

The completion contract needs a durable parent-call key and separate dialog
or branch keys for forks, retries, redirects and simultaneous ringing. The
first accepted owner binding is immutable; a branch outcome must not create a
second parent history row or turn an unanswered fork into a completed call.
Persist terminal outcomes from an authenticated, replay-safe Kamailio dialog
event source for direct internal calls, including cancellation, rejection and
timeout. Reconcile out-of-order initiation/completion and duplicate events
transactionally, with a bounded retention/retry policy. Do not construct a
completed record from an INVITE, provisional response, websocket event, or
FreeSWITCH CDR heuristic. Emergency calls reaching FreeSWITCH require an
exactly correlated protected marker on the A-leg before its authenticated
CDR can attach the optional owner snapshot; keep the existing emergency
gateway route if identity capture or its binder is unavailable. The CDR and
route schema, ownership mapper, and personal-history tests must be reviewed
together before any new direction is accepted.

Likely change surfaces are the deployed Kamailio initial-INVITE/auth and
local/emergency paths (source reference `infra/configs/kamailio/kamailio.cfg`),
a narrow authenticated initiation/completion endpoint or event consumer,
`server/cloud-recordings/correlation.ts` or a separate history-only binding
ledger, `server/pbx/cdr-ownership.ts`, `server/pbx/cdr-processor.ts`, and the
explicit migration and focused PostgreSQL/SIP tests. Whether the recording
route table can safely hold nonrecorded history is a design decision, not an
assumption; do not enable audio capture as a side effect of history.

## Release decisions and evidence gates

Before implementation, audit the **actual protected runtime** Kamailio and
FreeSWITCH config, including which initial INVITEs pass digest auth, where
client headers are stripped, local wake/fork behavior, emergency ingress,
and whether authenticated dialog events can be delivered durably. Select the
parent and branch IDs and prove how they map to any FreeSWITCH UUID without
trusting client-provided values. Choose a history-only ledger versus an
explicitly reviewed recording-route schema extension, plus retention and
rollback semantics. If the current auth condition leaves ambiguous internal
ingress, obtain a separate SIP policy decision; do not harden admission as a
side effect of history work.

Ship default-off behind a separately reviewed candidate configuration and
explicit migration. Protected backup and parser checks precede rollout;
rollback disables new attribution and restores the prior routing configuration
without altering immutable historical owner snapshots. Test two tenants and
reassigned extensions, spoofed/duplicate headers, unauthenticated and
cross-tenant callers, unowned/shared destinations, failed routes, forked and
cancelled dialogs, duplicate/reordered events, missing binder/DB, and
emergency routing with no attribution. Repeat with actual handsets and real
FreeSWITCH/Kamailio signaling; verify call completion, no SIP wake/audio
regression, and no recording side effect. Source tests or a green API build
alone are neither deployment evidence nor real-call media evidence.
