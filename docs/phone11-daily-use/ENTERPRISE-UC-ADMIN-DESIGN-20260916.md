# Phone11 enterprise UC administration

Research and source inspection: 16 September 2026. This design extends Phone11; it is not evidence of a deployed enterprise service.

## Current capability

Settings exposes workspace administration to owners/admins. `/admin` links extensions, numbers, IVR, ring groups, queues and business hours to PBX APIs. The extension view lists assignments and creates unassigned extensions; person assignment explicitly remains read-only until a real directory is connected. `/admin/users` is unavailable. Therefore Phone11 has a PBX administration foundation, not complete employee lifecycle management. Source-backed screens still require deployment and tenant acceptance tests.

## Reference findings

- Zoom separates general users from phone users, assigning phone licences/packages and extensions in Phone System Management > Users & Rooms. Adopt separate identity and phone provisioning states, rather than treating an extension as an employee. [Managing phone users](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069309)
- Zoom supplies scoped Phone roles for users, sites and queues. Adopt least-privilege roles and explicit scope, not a universal admin switch. [Phone role management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0070100)
- Teams voice application policies limit the actions delegated to supervisors, and authorization also names the particular queue/auto attendant. Adopt both action permission and resource scope. [Voice applications policies](https://learn.microsoft.com/en-us/microsoftteams/manage-voice-applications-policies)
- Teams allows authorized supervisors to change hours, routing, members and greetings. Put these daily operations in a small supervisor view; keep identity and infrastructure administration elsewhere. [Supervisor settings](https://support.microsoft.com/en-us/teams/calls-devices/manage-your-call-queue-and-auto-attendant-settings-in-microsoft-teams)

These are product design recommendations derived from the cited capabilities, not a claim that Phone11 has vendor feature parity.

## Navigation and layout

Desktop: persistent left navigation, company selector and current role at the top, searchable list in the centre, selected record detail on the right. Constrain content width for forms; use dense accessible tables for large directories. Mobile: Settings > Workspace administration, single-column lists and pushed detail screens with persistent Back. Use system/light/dark appearance consistently.

| Section | Contents |
| --- | --- |
| Overview | Setup tasks, real usage totals, service alerts with timestamps |
| People & access | Employees, invitations, groups, roles, sites |
| Phone system | Extensions, numbers, auto attendants/IVR, ring groups, queues, schedules, voicemail |
| Devices | Assigned desk phones and app registrations, last seen, provisioning state |
| Policies | Calling, recording/AI, retention, emergency location |
| Reports | Call activity, queue outcomes, quality; only measured values |
| Security & audit | Admin changes, sessions, SSO/SCIM configuration when supported |
| Integrations | Explicit account/tenant mappings for Super Number, LINE and providers |

Unsupported sections remain absent from primary navigation until usable. Search, filters and clear empty/error/loading states replace decorative cards. Errors must not appear as zero users or zero calls. No billable-call action is included.

## People workflow: first implementation priority

List columns: name, work email, site/team, access role, extension, assigned number, invitation/access state, phone provisioning state. Filters: active, invited, suspended, needs phone setup; search name/email/extension. User detail tabs: Profile, Calling, Groups, Policies, Devices, Activity.

Invite flow: choose company/site, enter work email/name, choose least-privileged role, optionally assign an unallocated extension/number, review, send invitation. Show acceptance separately from phone provisioning. Invite retries use one stable operation ID and must not send duplicate mail. Invitations expire and are revocable. Bulk CSV gets validation preview, row errors and explicit final confirmation, with auditable per-row results.

Suspend flow: show affected sessions, extension and queue memberships before confirmation. Enforce access revocation server-side and reconcile cached memberships. Do not silently terminate a live call or reassign its number. Offboarding offers explicit number/queue reassignment and retention decisions; it cannot erase private recordings or follow-up tasks by default. Never remove the last owner.

## Roles and boundaries

Start with existing owner/admin/member enforcement. Add scoped phone administrator, queue supervisor and read-only auditor only with matching server policy enforcement. A supervisor can manage only assigned queues and approved actions. Recording access is an independent permission, not implied by company admin status. Tenant IDs come from authenticated membership; UI selection never grants access. Keep Phone11 and Zoom adapters separate and explicit; LINE customers are external participants, not employee accounts.

## PBX changes

Number detail shows assigned destination, caller ID, site/emergency location and configuration status. Routing editor supports open/closed/holiday branches, timeout/fallback and a non-calling route simulation. Save draft, validate dependencies, review impact and publish are distinct steps. A saved database row is not a successful PBX activation. Record actor, tenant, resource, before/after revision and deployment receipt; rollback restores a known revision. Hide credentials and never expose SIP secrets in a directory response.

## Acceptance and delivery

1. Land honest responsive dashboard states (included in this change).
2. Implement employee directory and invitation lifecycle with tenant-scoped endpoints, role checks, last-owner protection, idempotency and audit. Existing extension records are not a substitute for this work.
3. Wire assignment, suspension and offboarding to provisioning and revocation; exercise cross-tenant denial and stale-session rejection.
4. Add draft/validate/publish routing and delegated supervisor operations; run two-tenant/two-DID non-production pilot.
5. Add devices, real analytics and SSO/SCIM when their service integrations are commissioned.

Release checks: keyboard/VoiceOver, Thai/English long names, narrow handset and desktop layouts, permission denial via direct URL and API, error/retry preserving edits, concurrent number assignment, invitation expiry/replay, last owner, suspension with live call, private recording isolation, audit persistence and rollback. No production tenant mutation or invitation is performed by this design.
