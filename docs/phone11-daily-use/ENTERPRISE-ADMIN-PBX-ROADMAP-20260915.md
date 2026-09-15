# Phone11 enterprise administration and PBX roadmap — 15 September 2026

## Product direction

Phone11 should give each enterprise a private administration workspace with simple defaults and progressively deeper controls. The first usable release should let a workspace administrator assign people and numbers, define how incoming calls flow, see whether endpoints are healthy, and understand failed or poor-quality calls without exposing another tenant's data.

Zoom Phone and Microsoft Teams Phone converge on the same core model:

- scoped administrators for a site, queue, auto receptionist, recordings, compliance, and devices;
- users, extensions, direct numbers, sites, emergency locations, devices, and policies;
- auto receptionists, business hours, holidays, call queues, overflow, voicemail, and shared lines;
- call logs, queue service levels, alerts, and per-call network-quality evidence;
- recording access, retention, residency, consent, audit, and export controls.

Phone11 should use that model while keeping the default navigation small: **Overview**, **People & numbers**, **Call routing**, **Quality**, and **Governance**. Advanced settings belong inside the relevant object rather than in a large flat menu.

## Evidence states

The following labels prevent source code, a database change, a deployment, and a real call from being treated as the same result.

- **Source-ready** means the implementation is checked in or present as a focused source candidate and has relevant automated coverage.
- **Live-deployed** means the exact reviewed migration, application build, and telephony configuration have been applied to the intended environment and their version has been verified there.
- **Device-proven** means the deployed behavior has passed a real tenant, DID, carrier, and handset test for the stated scenario.

Unless a row explicitly says otherwise, the items below are source-ready only.

| Capability | Source state | Live-deployed or device-proven evidence |
| --- | --- | --- |
| Advanced PBX schema | A repeatable PostgreSQL migration defines IVR menus/actions, ring groups/members, queues/agents/statistics, and time conditions/rules. It adds constraints, indexes, foreign keys, and tenant-safety triggers. Its isolated PostgreSQL test applies it twice and verifies representative data and cross-tenant rejection. | No evidence in this work that the migration has been applied to the live Phone11 database. |
| PBX schema preflight | A read-only preflight checks the required tenant/extension base columns and classifies the advanced schema as `absent`, `compatible`, or `incompatible`. It uses a read-only transaction, rolls back, and does not print credentials. Unit tests and an isolated PostgreSQL transition from absent to compatible pass. | No approved live-database preflight result is recorded here. |
| PBX administration authorization | IVR, ring-group, queue, and schedule APIs require a workspace owner/admin, scope reads and writes to the selected workspace, reject cross-workspace member assignment, and record the actor and source address for create events. | No live multi-tenant authorization acceptance is recorded here. |
| Incoming DID dispatch | The source candidate validates extension, IVR, ring-group, queue, and time-condition targets within the DID's tenant. It passes an encoded, server-validated internal target to FreeSWITCH, keeps tenant ring-all as the explicit unassigned-DID fallback, and fails closed for missing, inactive, malformed, or cross-tenant targets. Focused Kamailio/API/FreeSWITCH route tests cover these cases. | The candidate Kamailio and FreeSWITCH routing has not been shown as deployed to the live telephony hosts or proven with a carrier DID. |
| Admin routing screens | The source candidate replaces mock extension, phone-number, and IVR data. It wires extensions, numbers, IVR, ring groups, queues, and business hours to the signed-in tenant. The current flows cover safe list/create/delete operations where supported, plus loading, error, refresh, and empty states. | No deployed admin build, live tenant data acceptance, or handset/desktop acceptance is recorded here. |
| Core extension calling | Existing source supports authenticated extension and SIP/PSTN provisioning, direct-number assignment, CDRs, and recording policies. | Core extension calling has prior pilot evidence. That evidence does not prove advanced IVR, group, queue, schedule, or DID routing. |

## What is complete in source

### Reproducible schema and safe diagnosis

- `server/pbx/advanced-routing-migration.sql` is the reviewed, repeatable migration for all nine advanced-routing tables used by the PBX code.
- `scripts/phone11-pbx-schema-preflight.ts` is the read-only gate to run before and after migration. It reports whether the configured database is ready for migration, compatible, or incompatible without changing data.
- The migration does not create tenant routes, members, agents, schedules, or DID assignments. Those remain explicit administrator actions.

### Tenant-safe DID routing

- The backend resolves the DID first and validates every configured route against that DID's tenant.
- Extension targets bridge only to active extensions and active SIP accounts in the same tenant.
- IVR, ring-group, queue, and time-condition targets are converted to a bounded internal format that preserves the validated tenant and target identifiers for FreeSWITCH.
- Unknown targets and missing, inactive, or cross-tenant objects return a failure rather than widening the route to every extension.
- An active DID with no assigned route retains the explicit tenant-scoped ring-all behavior.

### Basic API-backed administrator workflows

- Extensions can be listed, searched, filtered by assignment, and created in an unassigned state after validating the extension number.
- Phone numbers can be listed, searched, and filtered by routing assignment. Current route and carrier status are visible; acquisition and route editing are clearly unavailable until carrier-backed provisioning is connected.
- IVR menus can be listed, created with a text greeting and no-response destination, and deleted.
- Ring groups can be listed, created with a strategy and timeout, and deleted.
- Queues can be listed, created with a strategy and capacity settings, and deleted.
- Business hours can be listed, created with weekday hours plus open/closed destinations, and deleted.
- The overview links to Business Hours and no longer presents hard-coded infrastructure health as live telemetry.

These screens establish a real tenant API path in source. They are not yet complete editors: the current Edit/Members controls do not configure ring-group membership, IVR digit actions do not have a complete editor, queue-agent membership and availability do not have a complete editor, and business hours do not yet provide full holiday, exception, or existing-rule editing.

## Remaining administration gaps

The following hidden or incomplete paths must not be used as operational evidence:

- **People / Users:** `app/admin/users.tsx` still renders `MOCK_USERS`; search, filters, and actions do not manage live workspace users.
- **Phone-number provisioning:** the visible number inventory is live and tenant-scoped, but ordering, porting, and route editing are intentionally unavailable until a carrier-backed provisioning workflow exists.
- **Analytics:** `lib/analytics/engine.ts` explicitly generates demo values with random call volume, metrics, sentiment, direction, hourly distribution, action items, and speakers. The admin analytics screen is therefore not an operational report.
- **System health:** `app/admin/system.tsx` still contains static server, SIP-trunk, codec, version, uptime, capacity, and health values. Its refresh delay, restart prompts, and export confirmation do not call operational services.
- **Advanced routing editors:** IVR digit actions, ring-group members and fallbacks, queue agents/availability/overflow, and holiday/exception schedules still need complete API-backed management.
- **Operations and governance:** live QoS, endpoint inventory, alerts, emergency locations/policies, recording governance, bulk lifecycle, delegated scopes, approvals, and audit review remain release work.

## Gates before a real advanced-PBX pilot

1. Run the read-only preflight against the approved target database and save the non-secret result. Stop on `incompatible`.
2. Review the database backup/rollback plan, apply the checked-in migration through the normal deployment process, and rerun the preflight until it reports `compatible`.
3. Review, commit, and deploy the exact DID-dispatch application and Kamailio/FreeSWITCH configuration together. Verify the running versions before any call.
4. Deploy the API-backed admin candidate, then prove that its objects persist and reload in one isolated workspace.
5. Create two isolated test users/extensions and one test DID with no customer traffic. Assign explicit IVR, ring-group, queue, and time-condition targets through the approved admin/API path.
6. Prove each inbound route with the real carrier DID and exact handset build, including missing/inactive targets, timeout/overflow, after-hours behavior, two-way audio, and CDR/audit correlation.
7. Prove a second tenant cannot read, change, join, or receive calls from the first tenant's objects.
8. Keep the remaining mock Users, Analytics, and System Health routes hidden until they are replaced with live data; keep number provisioning explicitly unavailable until it is carrier-backed.

## Release slices

### Slice 1 — Testable office PBX

- workspace owner/admin access;
- two users and extensions;
- one direct number;
- IVR greeting and digit actions;
- simultaneous/sequential ring groups;
- queue members, timeout, overflow, voicemail, and business hours;
- call logs and audit trail;
- explicit disabled state for features that are not commissioned.

Acceptance: internal extension call, inbound direct extension, inbound IVR choice, ring-group answer, queue answer/timeout, after-hours route, voicemail, recording-policy behavior, and cross-tenant denial all succeed in an isolated tenant.

### Slice 2 — Enterprise operations

- delegated roles targeted to a site, queue, auto receptionist, recording set, compliance scope, or device group;
- multi-site number and emergency-location management;
- queue availability, service level, abandoned calls, wait time, talk time, wrap-up, and threshold alerts;
- per-call quality timeline with loss, jitter, latency, MOS, route, endpoint, codec, and correlated client/server identifiers;
- device inventory, assigned user, firmware/app version, connectivity, restart/update actions, and audit.

### Slice 3 — Governance and scale

- recording-policy inheritance and locks, excluded numbers, retention, deletion, export, legal hold, and data residency;
- bulk user/number lifecycle, templates, CSV validation, number ordering and porting;
- scheduled reports and alerts;
- licensing, subscriptions, and capacity limits;
- maker-checker approval for high-impact routing, emergency, recording, deletion, and bulk changes.

## Safe PBX test sequence

1. Run the read-only schema preflight in the isolated environment.
2. Apply the reviewed PBX migration only if the base schema is compatible; rerun the preflight and require `compatible`.
3. Create two test extensions and one test DID with no customer traffic.
4. Verify internal calls before adding IVR, group, queue, and schedule routes.
5. Test each inbound target separately, including missing/inactive target and timeout fallback.
6. Verify two-way audio, mute, hold, transfer where enabled, hang-up, recording policy, CDR, audit, and tenant isolation.
7. Run repeated locked/background handset calls and Wi-Fi/cellular movement against the exact build.
8. Promote only the routes and screens that have deployed and device evidence; keep the rest hidden or explicitly unavailable.

## Current decision

Core extension calling can continue within the evidence already established for the existing pilot. The advanced PBX implementation has moved from missing source foundations to a repeatable schema migration, a read-only compatibility gate, tenant-safe DID-dispatch candidates, and basic API-backed routing screens. It is still not ready to be called live-deployed or device-proven.

Advanced IVR, ring-group, queue, and business-hours testing can begin only after the database preflight/migration, the exact application and telephony configuration deployment, and an isolated tenant/DID setup are complete. Source tests, API wiring, preview screens, and prior extension calls do not by themselves establish that result.

## Official comparison sources

- [Zoom Phone role management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0070100)
- [Zoom Phone admin setup and features](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257)
- [Zoom Phone call queues](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064844)
- [Zoom Phone quality-of-service dashboard](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0070057)
- [Microsoft Teams Phone setup](https://learn.microsoft.com/en-us/microsoftteams/setting-up-your-phone-system)
- [Microsoft Teams voice application policies](https://learn.microsoft.com/en-us/microsoftteams/manage-voice-applications-policies)
- [Microsoft Teams emergency calling policies](https://learn.microsoft.com/en-us/microsoftteams/manage-emergency-calling-policies)
- [Microsoft Teams phone device management](https://learn.microsoft.com/en-us/microsoftteams/phones/manage-teams-phones)
- [Microsoft Teams Call Analytics](https://learn.microsoft.com/en-us/microsoftteams/use-call-analytics-to-troubleshoot-poor-call-quality)
