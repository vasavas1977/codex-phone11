# Personal workspace call history

The `pbx.selfService.callHistory` query returns completed PBX call records
owned by the authenticated member at call time. It does not expose the admin
CDR inventory or transfer old calls to a new extension assignee.

Input is an explicit `tenantId`, a bounded `limit` (default 50, maximum 100),
and an optional `{startedAt,id}` cursor. The query rechecks active workspace
membership, active tenant, and an active assigned user extension. It repeats
that gate in the history SELECT so a revocation between the two reads cannot
release records. Visibility uses immutable caller/callee user IDs on the
parent or a same-tenant leg; incomplete snapshots and unowned rows are absent.

Each item includes its CDR ID, call UUID, direction, disposition, counterpart
numbers, `callback_number`, duration and start time. The callback is resolved
only from the parent call-time identity. Legacy leg-owned records without an
owned parent identity have no callback action. Clients must not guess it from
the current extension assignment. The keyset uses the original six-digit
PostgreSQL UTC timestamp plus ID, preserving calls within one millisecond.

The desktop uses bounded pages and explicit Load more. Mobile offers Workspace
and This device history separately; This device preserves the existing daily
pilot default. Native records and server records are never merged by matching
phone number or approximate time. Workspace results remain memory-only and
must clear on account/workspace changes; failed requests show an error instead
of manufacturing calls or falling back to a broader admin endpoint.

## Coverage and release boundary

The upstream trusted route capture currently covers inbound/outbound routes.
The checked-in FreeSWITCH `xml_curl` dialplan callback is disabled. Kamailio
relays ordinary four-digit internal calls directly to the registered endpoint,
so they do not produce a FreeSWITCH channel or XML CDR. It routes emergency
calls to FreeSWITCH without a protected call-time owner marker; the existing
outbound marker explicitly excludes emergency and internal calls. The trusted
recording route table also constrains direction to inbound/outbound. Neither
the unused backend dialplan callback nor a From/domain or caller-ID lookup can
close these gaps. Unattributed records remain excluded even though the history
query can display owned internal/emergency snapshots. A separate release must
carry post-auth identity through the actual Kamailio paths, validate tenant and
active assignment, and persist immutable ownership with exact call correlation
and completion evidence; internal calls need an ingestion path independent of
FreeSWITCH CDRs. Emergency routing must continue when attribution is absent.
Real endpoint tests are required. Never repair history by resolving current
extension ownership at read time.

The existing monthly `selfService.usage` response remains unchanged. The new
contract and clients require a matching API/client release; the running 3020
candidate and installed Build 110 predate this source slice. Neither is
evidence that personal workspace history is live.

## Database checks run

On 30 September, the focused personal-history and inbox tests plus the isolated
PostgreSQL ownership suites passed 22 cases. The dedicated loopback database
contained synthetic fixtures only. Tests exercised tied/sub-millisecond cursor
paging, extension reassignment, cross-tenant exclusion, unowned internal
records, revoked membership/assignment, revocation between reads and legacy
leg-owned callback suppression. No hosted rows were changed.

The combined server, PostgreSQL, mobile hook and Recents checks passed 47
cases. Full root and desktop test commands, root/desktop TypeScript and both
backend/desktop builds also passed. Independent source review approved the
server/desktop slice and the final mobile callback/lifecycle delta. These
checks do not establish deployed history or real-call ingestion coverage.

All 13 PR jobs passed at `c73c3d3c3d5d44aa593f9afb81c963db6fb4fe87`.
A subsequent dedicated CI job runs the PostgreSQL history/usage suites and
PBX migration suites with explicit loopback database assertions, preventing
those integration checks from silently skipping when an environment variable
is missing. The combined local run of those four suites passed 19 cases.
