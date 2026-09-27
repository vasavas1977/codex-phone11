# Zoom admin reference for Phone11 — 27 September 2026

## Evidence and scope

Reviewed the owner's authenticated Zoom Admin center in Chrome, read-only.
Inspected phone users, a user detail/settings page, queues and queue details,
auto receptionists and routing, and account meeting policies. No Zoom settings
were saved, calls placed, messages sent, or recordings played. This is a
reference review of selected flows, not an exhaustive product or accessibility audit.

Accepted screenshots and a local visual report are in
`/tmp/phone11-zoom-admin-audit-20260927/`. They contain private account data and
must remain local, outside version control and public deliverables. The rejected
early detail/list captures are not evidence in the report.

Phone11 source mapping was independently reviewed at `fe374e4229b5a758c63f839b30732f6f1e576018`
in the voicemail/status integration checkout. This mapping does not establish
deployment or successful provider execution.

## Observed flow and design to reuse

| Step | Observed Zoom pattern | Phone11 direction | Evidence |
| --- | --- | --- | --- |
| 1. Phone users | Persistent admin sidebar; Assigned/Pending tabs; search by name, extension or number; filtered table and row actions. Clear inventory structure, but dense at narrow widths. | Consistent admin shell; searchable member/extension inventory; retain workspace context and capability gates. | `01-phone-users.png` |
| 2. User settings | Breadcrumb, named user, Profile/Policy/History/User Settings tabs. Hours, ringing endpoints, ring mode, wait time, busy and unanswered destinations grouped together. | One member detail destination connecting account, extension, call handling and activity; show which actions are supported. | `02-user-call-handling.png` |
| 3. Queue detail | Profile/Policy/Voicemail tabs; members and administration alongside extension/number identity. | Group agents, ringing, wait and overflow settings in an understandable queue detail view. | `04-queue-detail.png` |
| 4. Auto receptionist | Consistent detail tabs, number/extension and timezone; IVR destination list, no-input outcome and holiday routing. | Call-routing summary with greeting, keypad destinations and fallback; separate regular hours from dated exceptions. | `06-auto-receptionist.png`, `07-receptionist-routing.png` |
| 5. Meeting policies | Search and category navigation; account defaults explained; locks indicate enforced inheritance. | Distinguish workspace defaults, host rights and enforced policy; expose only server-enforced options. | `05-meeting-policies.png` |

## Existing Phone11 foundation and gaps

| Area | Existing source | Gap / next change |
| --- | --- | --- |
| Admin navigation | `app/admin/index.tsx` groups People/workspace, Phone system, Meetings and Insights. Personal navigation is separate in `components/portal/portal-shell.tsx`. | Add persistent desktop admin navigation; current pages are independent Back screens. Preserve mobile navigation and authorization checks. |
| People | `app/admin/users.tsx` edits membership role and active state. `app/admin/extensions.tsx` creates and assigns extensions. | Join these views through member detail. Invitation and coordinated provisioning/deprovisioning are separate functional work; deactivation currently does not revoke SIP assignment. |
| Numbers and routing | `app/admin/dids.tsx` inventories carrier-provisioned DIDs and destination routing. `app/admin/ivr.tsx` provides TTS/key actions. | Show readable destination summaries and linked details. Number purchase/porting and uploaded greeting preview are not present here. |
| Ring groups and queues | `app/admin/ring-groups.tsx`; `app/admin/queues.tsx` expose membership, timeout and overflow. | Preserve honest runtime limits: legacy queue strategies normalize to Ring All under current FIFO runtime. Do not add unsupported strategy choices for appearance. |
| Hours | `app/admin/schedules.tsx` provides one Mon–Fri block and open/closed destinations. | Dated holidays, multiple daily periods and exceptions need backend/runtime support. Workspace timezone changes do not currently change routing schedules. |
| Voicemail | Personal voicemail and routing destinations exist. | Add dedicated mailbox/storage/retention administration only against real storage and authorization contracts. |
| Meetings | `app/admin/meetings.tsx` manages per-chat hosting grants. | Broader default/locked policies, lobby/host controls and recording policies require enforced backend semantics. |
| Operations | Analytics exist; `app/admin/system.tsx` is an unavailable placeholder. | Report measured service health with freshness; never display assumed readiness. |

## Implementation order and acceptance

1. Build the shared admin shell and reusable table/detail layout on existing
   authorized routes. Retain workspace identity, responsive navigation, selected
   page, breadcrumbs, loading/error/empty states and keyboard focus.
2. Connect people to extensions and existing call-handling views. Add search and
   explicit assignment state. Do not imply that membership deactivation revokes
   calling until that coordinated operation is implemented and tested.
3. Apply the same structure to numbers, queues, IVR and schedules. Show a concise
   call-path summary before editing. Validate persisted routing and fallback
   behavior against the PBX before calling these flows accepted.
4. Implement missing invitation, holiday, mailbox and meeting-policy contracts
   as independently scoped changes with tenant/role tests and runtime evidence.

Use Phone11 typography, branding and data. Reuse Zoom's task grouping and
interaction clarity, not its private account records or claims about capabilities.

## Accessibility and evidence limits

The captured Zoom screens use small gray labels, dense rows and icon-only policy
locks. These are risks to check rather than defects proven by screenshots.
Phone11 should retain readable labels, visible focus, accessible names and an
explicit explanation of disabled or inherited controls. Keyboard navigation,
screen-reader behavior, measured contrast, validation and mutation outcomes
were not tested in the Zoom account. Viewing controls does not prove their
provider behavior. Desktop, mobile and admin parity are separate acceptance tracks.
