# Phone11 completion checklist — 22 September 2026

## Status boundary

This checklist records current evidence. A checked **source** or **deployment**
item is not physical-handset, provider, or customer acceptance.

| Area | Current evidence | Still required |
| --- | --- | --- |
| Password recovery | Minimal compatible frontend `076ddac` and serialized recovery backend `bbd14cf` are live. One owner email was provider-confirmed Delivered with a direct fragment-token link; unknown-address and invalid-token checks passed. | Owner completes new password and confirms sign-in; real-account reuse/session revocation acceptance remains separate. |
| Web portal and management API | Static portal and workerless API candidate are live; unavailable capabilities are shown truthfully. | Authenticated browser tests for an ordinary user and a second tenant; commission only the approved optional management schemas. |
| Profile photos and Chat Meet affordance | Tenant-bound avatar/UI and the Meet entry point are implemented and source-reviewed. Meet opens the admitted meeting flow and does not invite a recipient automatically. | Deploy photo metadata/deletion schema, HTTP routes, and retention worker; test upload, read, removal, and membership revocation. |
| Connect11 plain video | Admission schema, pilot records, and protected provider-join probes are recorded. The LiveKit `WeakRef` Room-constructor cause is fixed in Build 80, which passed package verification. | Install Build 80 in place and pass the two-iPhone media/lifecycle matrix. |
| Presence and read receipts | The presence/read-receipt delta and parallel API candidate activation are recorded. | Real two-phone acceptance for read timestamps/details, typing cleanup, and foreground/away/on-call presence. |
| Person mentions and `@all` | Person mentions and the server-authoritative `@all` contract are implemented. | Apply the guarded `@all` live delta with the profile release; prove admin-only `@all` and ordinary-member refusal. |
| Ordinary Team Chat alerts | Enrollment and an eligible device were observed; API/worker configuration checks passed. | Prove a real locked/background alert, authorized open, revocation/logout, denial, and network-loss behavior. |
| Profile/DND/mobile reachability | Source behavior and tests exist. | Controlled baseline rollout, then workspace persistence, DND expiry/reset, alert suppression, and standby reachability acceptance. |

## Ordered completion gates

1. [ ] **Pass the Build 80 conference acceptance.** Use the paired pilot iPhones and record join, local/remote video, two-way audio, mute/camera, leave/rejoin, reconnect, lock/background, eviction/remint denial, and SIP interruption/cleanup. A `room_connect` result after this package is the point for one bounded Connect11 provider-log correlation; Build 80 must not trigger another speculative client fix first.

2. [ ] **Commission the two-part maintenance fence.** The API edge must reject new mutation traffic and uploads while the SIP fence rejects every new initial INVITE. Both must remain active through baseline replacement and must be proved by a root-owned aggregate guard record.

3. [ ] **Release profile/DND, standby reachability, and `@all` through the existing guarded baseline operator.** Pin the final source/image, apply only verified additive migrations, preserve wake and calling, and keep the old dispatcher disabled if rollback occurs after DND exposure.

4. [ ] **Complete Team Chat device acceptance.** Verify read receipts, typing and presence separately from alert delivery. Use English and Thai member search; verify `@all` only after gate 3.

5. [ ] **Complete ordinary-alert device acceptance.** Test an actual second recipient while locked/backgrounded, then tap routing, duplicate handling, expiry, permission denial, logout/workspace change, and short network interruption. Provider acceptance alone is insufficient.

6. [ ] **Commission private profile photos.** Deploy the matching API plus photo metadata/deletion schema and retention worker after gate 2. Prove two-workspace isolation, revocation on the next read, bounded upload validation, removal, and cleanup recovery.

7. [ ] **Complete management capabilities deliberately.** The live database lacks tenant settings, numbers, sites, ring groups, queues, IVR, and business-hours tables. Prioritize each approved schema/API slice; do not replace truthful unavailable states with simulated success. Test administrator, ordinary-user, denied cross-tenant, and extension-reassignment privacy behavior.

## Maintenance-fence implementation contract

### Existing support and exact gap

`scripts/phone11-profile-dnd-rollout.py` already accepts a separately pinned
`guard.program`, requires matching active-fence evidence before a baseline stop,
and rechecks it after restart/rollback. It is **not** the controller: it neither
installs an edge gate nor activates an SIP gate. The host-admission runbook is
therefore correct that the rollout remains blocked until an owner authorizes and
commissions the missing control.

The smallest safe SIP addition is a static, disabled-by-default Kamailio
maintenance-admission route plus a root-owned local controller. It must not
change FreeSWITCH, the wake URL, provider credentials, routing destinations, or
existing media paths.

### Required route boundary

The maintenance route belongs in the main `request_route` only after the
existing `has_totag()` in-dialog path and the `CANCEL` path have exited, and
immediately before the initial `INVITE` branch. It evaluates only an initial
`INVITE`; it must not alter `REGISTER`, `OPTIONS`, `SUBSCRIBE`, `PUBLISH`,
`MESSAGE`, `ACK`, `BYE`, `CANCEL`, or a re-INVITE. When active, it returns one
reviewed temporary rejection for every new initial INVITE before authentication,
wake, location lookup, DID routing, FreeSWITCH selection, or media allocation.

Kamailio already loads `htable` and exposes a local JSON-RPC FIFO in the tracked
configuration. A reviewed controller may use that existing local facility only
after the live daemon, RPC method, permissions, and process identity have been
verified. It must set an explicit expiring maintenance state and produce an
immutable activation record. It must not rely on a process restart, a mutable
shell flag, an operator lock, a zero-call snapshot, or a broad network block.

### Controller evidence contract

The controller must atomically activate and restore the exact edge and SIP
controls. Its evidence record must bind the operation ID, expiry, active and
restore configuration hashes, controller/config/process identities, both control
states, and the aggregate coverage required by `phone11-profile-dnd-guard/v1`.
Any expired, missing, ambiguous, mismatched, or restarted control generation is
a failed fence. The rollout operator must then refuse a baseline stop; a failed
activation restores both controls before reporting failure.

### Required tests before a production manifest

- Parse the exact deployed Kamailio configuration with the new route present and
  prove the default maintenance state admits unchanged traffic.
- With the fence active, prove temporary rejection for new carrier/PSTN,
  registered-extension, DID, queue/ring-group/IVR, conference, voicemail, and
  emergency initial INVITEs. No routing, wake HTTP request, location lookup, or
  media allocation may occur.
- Establish a dialog before activation, then prove ACK, BYE, CANCEL and
  in-dialog re-INVITE keep their existing relay/media behavior. Prove REGISTER,
  OPTIONS, SUBSCRIBE and PUBLISH remain unchanged.
- Exercise controller activation, expiry, duplicate activation, invalid state,
  daemon/config identity drift, partial edge/SIP activation, helper crash, and
  exact restore. Verify that any failure prevents baseline replacement.
- Run the existing operator tests against a real controller fixture, not only
  mocked guard JSON. Verify its before-stop, post-stop, rollback, and release
  phases all require the same unexpired fence ID/evidence digest.
- In the authorized maintenance window, independently verify the active edge
  and SIP states, drain every source for the required stability interval, then
  verify normal new-call admission after release. This is operational evidence,
  separate from source tests.

## Active-scope protection

Password recovery is deployed and recorded in commit `a459926`; tenant-settings
work remains a separate reviewed slice. Keep the fence, meeting, photo, and
management releases distinct, with source, deployment, and acceptance evidence
for each. Do not include the unrelated local `pnpm-workspace.yaml`.

## Completion definition

Phone11 is ready for the intended pilot only when the relevant source checks,
guarded deployment receipts, provider admission evidence, and the two-physical-
phone matrices above all pass. Keep SIP calling, wake delivery, and recording
acceptance as their own evidence streams throughout.

## Evidence records

- `CONFERENCE-OWNERSHIP-HANDOFF-20260921.md`
- `PLAIN-VIDEO-ADMISSION-READINESS-20260920.md`
- `READ-RECEIPTS-LIVE-ACCEPTANCE-20260920.md`
- `READ-RECEIPTS-PARALLEL-API-ACTIVATION-20260920.md`
- `WEB-MANAGEMENT-LIVE-20260921.md`
- `WEB-MANAGEMENT-PHOTO-READINESS-20260921.md`
- `PROFILE-DND-HOST-ADMISSION-CONTRACT-20260921.md`
- `PROFILE-DND-ROLLOUT-OPERATOR-20260920.md`

## Paired-device inventory refresh

On 22 September 2026, `devicectl` reported both paired devices available. The iPhone 17 Pro Max has Phone11 1.0.0 (80); the iPhone 15 Pro Max has Phone11 1.0.0 (75). This is installed-package inventory, not proof of account-to-device mapping, meeting media, notifications, or successful calling. No app was installed, launched, or replaced during this check. The second device needs the same verified daily-pilot Build 80 before the paired conference acceptance.

## Source acceptance update

Initial-INVITE maintenance control commit `9341268` passed independent source review after three concrete defects were corrected; reported focused checks are 14 controller tests, 7 DID config tests, and 5 wake config tests. This does not commission the aggregate edge/SIP fence or authorize a baseline replacement without runtime checks.

## Existing server compatibility

The exact SIP configuration in `9341268` passed an isolated `kamailio -c` parser run against the existing 5.8.4-bookworm image (`f7c3a2412b49f1372c70b2ad06da6f28cb34a044ee3ae408c7b960ef484bb5b7`). The main agent verified the retained record and its digest: exit 0 and `config file ok, exiting...`; evidence is retained on the VoIP host at `/opt/phone11ai/maintenance-validation-9341268/parser-evidence-tmpfs.json` (SHA-256 `2a2e9ad2c3b60137a7fbf2c7adfce04c131ab3142b83f786645f0f713f249998`). This was isolated with no network or published ports, read-only configuration/root filesystem, and temporary container-local FIFO storage. It does not prove active maintenance rejection, existing-dialog preservation, aggregate edge fencing, or the separately pinned 5.8.8 CI gate. No live SIP restart or activation occurred.

## Management database target

A read-only catalog and Nginx route check established that public `/api/trpc` and `/api/trpc/` use VoIP port 3003 (`cp11-api-candidate-next`, image prefix `2e7225e80ec7`). Its `phone11ai/public` database has no `tenant_settings` table and has the required single-column `tenants(id)` primary key. The older edge-host application has a different, incompatible 22-column table despite the same database/schema names; do not apply the new migration there. No production schema or customer rows were changed by discovery. The minimal settings migration and API slice passed independent source review and were committed as `9804c2f`; 72 focused tests against isolated PostgreSQL and TypeScript passed. Production still requires the target-bound backup, restore rehearsal, migration receipt, candidate release and authenticated browser acceptance.
