# Phone11 completion checklist — 22 September 2026

## Status boundary

This checklist records current evidence. A checked **source** or **deployment**
item is not physical-handset, provider, or customer acceptance.

| Area | Current evidence | Still required |
| --- | --- | --- |
| Password recovery | Static portal `1de803b` and serialized recovery backend `bbd14cf` are live. The post-activation browser showed enabled sign-in and Forgot password controls; no credential or reset submission occurred. Historical provider-delivery evidence remains recorded separately. | Owner completes a new password and confirms sign-in; real-account reuse/session-revocation acceptance remains separate. |
| Web portal and management API | Static portal `1de803b` and the tenant-settings candidate at port 3005 are live. The only newly commissioned workspace setting is `businessHoursTimezone`; photos and the other optional management domains remain unavailable. | Authenticated owner/admin save and readback for timezone, ordinary-user and second-tenant browser checks, and deliberately approved future schema slices. |
| Profile photos and Chat Meet affordance | Tenant-bound avatar/UI and the Meet entry point are implemented and source-reviewed. Meet opens the admitted meeting flow and does not invite a recipient automatically. | Deploy photo metadata/deletion schema, HTTP routes, and retention worker; test upload, read, removal, and membership revocation. |
| Connect11 plain video | Admission schema, pilot records, and protected provider-join probes are recorded. The LiveKit `WeakRef` Room-constructor cause is fixed in Build 80, which passed package verification. | Both paired phones now report Build 80 after an in-place second-phone update; pass the two-iPhone media/lifecycle matrix. |
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

7. [ ] **Complete management capabilities deliberately.** The live tenant-settings slice exposes only `businessHoursTimezone`; numbers, sites, ring groups, queues, IVR, and the remaining business-hours management surfaces are still unavailable. Prioritize each approved schema/API slice; do not replace truthful unavailable states with simulated success. Test administrator, ordinary-user, denied cross-tenant, and extension-reassignment privacy behavior.

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

The selected source design uses two explicit host steps through the existing
temporary Instance Connect access: activate the edge first, then let the VoIP
guard verify fresh edge evidence before activating local SIP. It does not claim
atomic cross-host activation or restoration. Partial failure keeps the edge
closed until a separate owner-bound release. Release SIP first and edge last.
The evidence record must bind the operation ID, identical absolute expiry, active
and restore configuration hashes, controller/config/process identities, both
control states, and the aggregate coverage required by `phone11-profile-dnd-guard/v1`.
Any expired, missing, ambiguous, mismatched, or restarted control generation is
a failed fence. The rollout operator must then refuse a baseline stop; a failed
activation must not allow baseline replacement or silently release a foreign
operation. Provider-media admission remains an additional uncommissioned
boundary, so source guard work alone cannot establish production readiness.

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

Password recovery is deployed and recorded in commit `a459926`; the tenant-settings
candidate is a separate reviewed and activated slice. Keep the fence, meeting,
photo, and management releases distinct, with source, deployment, and acceptance
evidence for each. Do not include the unrelated local `pnpm-workspace.yaml`.

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
- `TENANT-SETTINGS-CANDIDATE-3005-20260922.md`
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

A read-only catalog and Nginx route check established the target VoIP `phone11ai/public` database and its required single-column `tenants(id)` primary key; the older edge-host application has a different, incompatible 22-column table despite the same database/schema names. The minimal settings migration and API slice passed independent source review and were committed as `9804c2f`; 72 focused tests against isolated PostgreSQL and TypeScript passed. The separately controlled target backup, restore rehearsal, migration, and candidate activation have now completed. Public tRPC routes use the healthy `cp11-api-candidate-settings` candidate on port 3005; the 3000 baseline, 3002 retained candidate, 3003 predecessor, and 3004 recovery candidate remain healthy. This does not establish an authenticated timezone save, cross-tenant browser acceptance, or delivery of numbers, sites, ring groups, queues, IVR, photos, or other optional management schemas.

## Connect11 maintenance coordination

The `Complete Connect11 project` task reviewed Connect11 source `70734db4779351c4dfb554abf285b66fb89ef100` and reported no existing authoritative, tenant-scoped aggregate media-session/pending-operation count route. The capabilities route proves configuration readiness only; eviction status proves one customer-scoped durable operation, not provider occupancy. Phone11 admission leases and eviction-operation records can supply scoped control-plane counts but cannot stand in for media counts.

Previously issued plain-video tokens can start provider connections after Phone11 HTTP admission is fenced. Existing provider sessions can receive refreshed tokens and reconnect beyond the initial token lifetime. Neither waiting five minutes nor observing zero pending leases proves media quiescence. The baseline maintenance release must remain blocked until a reviewed tenant-scoped provider mapping/read and token/reconnect admission control establish the required guarantee. No provider or tenant-mapping changes were requested or applied during this coordination.

Reusable pointers supplied by that task: Connect11 `backend/app/api/v1/realtime.py` (plain-video routes), `backend/app/services/phone11_plain_video_evictions.py` (customer-scoped room/identity derivation and eviction status), and Phone11 `server/meetings/connect11-plain-video-config.ts`, `server/meetings/tenant-provider.ts`, and `server/meetings/plain-video-admission-repository.ts`. Recheck exact paths/source before implementation. Do not use project-wide room listing as tenant authorization, or expired leases as proof of disconnected media.

### Recommended architecture to evaluate next

Connect11 recommends reviewing a **Phone11 control-plane drain while external
provider media continues**, rather than adding permanent membership eviction as
a temporary maintenance operation. This is not clearance to remove the current
`provider_fence_uncommissioned` refusal. Phone11 does not carry WebRTC media, but
a safe release still needs exact route/container ownership for all meeting
capability, list, join, eviction and status requests; preserved server-only tenant
mapping and auth on replacement/rollback; drained mint/confirm and local eviction
operations; provider outbox ownership; graceful HTTP/background shutdown and
single notification/recording worker ownership; compatible schemas/sessions;
and a real existing-session/reconnect test across the restart. Review baseline
replacement separately from the later candidate/admission route switch. See
`server/_core/runtime-role.ts` drain behavior and each phase of
`scripts/phone11-profile-dnd-rollout.py` before changing the guard contract.

## Current operator review state

The settings candidate rollout's corrected fixed 3003-to-3005 topology passed
independent source review and is committed as `15d90f9` (21 focused tests reported).
The tenant-settings migration operator's Sol High correction passed 13 isolated
PostgreSQL 16.13 checks, passed independent source re-review, and is committed as
`fe32ad3`. Its production backup, restore rehearsal, mutation receipt, and image
deployment are recorded separately; authenticated timezone write/readback remains
an owner acceptance step.

## Live settings candidate and static portal — 22 September 2026

The settings candidate activation passed with public tRPC routed to port 3005 and
the baseline unchanged. Its protected manifest SHA-256 is
`73b1d0e9a3aabf7b4dc38aa177294fa399a67da35fa3dbab5f266b108a078bd2`;
the separate v2 receipt is `2119c72773f4086882afcb4f72b1a08afa5fa0f5ad42258e656b31fba245fe35`.
The candidate image is `sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9`,
source `9804c2f09f99453747e0bb54e23d3b6149f5b5cb`, bundle
`20e717154637803d1205498c994ebcb22028fdc4ec71095fcc21737507501121`, and
lock `24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`.
All five pinned services were read back healthy with their loopback bindings.

The edge static activation passed for source
`1de803b476f35659a45af77ba4b02a7a7d525f66`; its protected manifest is
`6a38dbd3b28e30af229d2721812ef44b2036d8e0c7299cb4a8432c65a6dfef79` and its
managed receipt is `6fa547cfca71abeab64b34eb070903c65ec2242bf8e77c1ae8ce48d33450675e`.
The sealed export manifest, release marker, and entry bundle read back as
`a7e918e791abdea2a008b5ac9b5e6a766a0cddd25937219d852dd142f21d3aa5`,
`e35b46d49ba675dc33e6e4563b6e3599d6bd4c0b58768d1aa048fbdde6c798e3`, and
`c8fc050f716e8fd3f4de5a665c1e9b7ec32bbe3466c69ad7174cac0ed740c6c8`.
The non-mutating static rollback dry run passed and binds the prior sealed
`076ddac` release. Browser checks after activation reached enabled Sign in and
Forgot password controls, the enabled Forgot-password email form, and the
signed-out workspace-settings owner/admin gate. No credentials, reset-email
submission, authenticated setting change, or browser write/readback occurred.

The uncommitted edge/aggregate maintenance proposal is **REQUEST_CHANGES**, not
ready to deploy: edge release publication/recovery must remain durable through
write/fsync failures and must drain the exact predecessor worker generations;
the unconditional provider blocker must precede lock creation; local SIP release
needs recoverable evidence if publication fails after release. The narrow SIP
absolute-expiry change was separately found to preserve legacy behavior. Do not
interpret aggregate passing tests as closure of these findings.

## Settings image and migration staging

The exact `9804c2f` source archive and frozen lockfile produced candidate image
`sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9`
using cached base `sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`.
The main agent independently verified source/archive/lock labels and read back
`/app/dist/index.mjs` SHA-256 `a402622920fadd4fb7216452ac68b5d9c27e15ec804eedace25d255665442305`
from a disposable network-isolated, read-only container. This production build
output is distinct from the earlier local minimal build output. No service was
started or replaced. The reviewed migration operator and SQL are staged as
root-owned mode-0600 files under `/opt/phone11ai/tenant-settings`; the mode-0700
journal directory exists and its migration receipt was absent. No migration ran.

Integration found that the candidate operator still required
`settingsAvailable:false` in its tenant response probe. Its v2 path must require
the newly available `businessHoursTimezone` capability while preserving legacy
v1 behavior. That correction and review must finish before activation.

## Live tenant-settings migration

A fresh protected PostgreSQL 16.13 dump (202,904 bytes, SHA-256
`141d776de725922a75bbceeb9f77eba631c4c96c446fe9bc0414fe13e70e24da`)
was restored successfully into an isolated, disposable cluster; restored catalog
matched the pinned absent-state catalog. The backup and linked proof files are
retained root-only under
`/opt/phone11ai/codex-phone11-deploy/infra/compose/pg-backup/tenant-settings-20260921T201120Z`.
The main agent independently verified all protected file hashes and permissions.

The first real preflight found a Python subprocess input/stdin conflict before
DB access. Commit `53bf8de` corrects that wrapper and Docker stdin forwarding,
with a real child-process stdin regression, isolated PostgreSQL checks and
independent source approval. The corrected production preflight returned
`PREPARE_READY`; apply returned `APPLIED receipt=WRITTEN`; the required read-only
recovery then returned `RECOVERY_VALID status=APPLIED`. The root-only receipt
`/var/lib/phone11-tenant-settings/receipt.json` has SHA-256
`5f7d86a4dd3773e4bdd17e8dfc6270544e7e96d1a0ccfb213543d2ab614b71e5`.
The additive migration creates the settings table without saving workspace rows.

The current 3003 Compose label referenced a deleted temporary file. Its exact
configuration was regenerated through the retained v1 manifest and cloning
code, then compared to the immutable running container: image, environment,
ports, mounts and access modes, networks, user, working directory, command,
entrypoint and healthcheck all matched. Protected recovered configuration:
`/root/phone11-current-3003-recovered-compose.json`, SHA-256
`75743a59eb0dbd6edf3c1ce6c2ec865d1d08b27e718d1ad6c78f9def838d9e58`.
No container was started or replaced.

The v2 rollout inventory subsequently refused the actual layered Nginx layout:
the existing recovery operator inserts its four locations between tRPC and the
shared marker. A bounded source correction is underway; routes remain unchanged.
The minimal workspace settings screen is committed as `1de803b` with seven
interaction checks and TypeScript passing; its static export is being prepared.

## Paired handset build alignment

Fresh 22 September installed-app reads confirm version 1.0.0 / Build 80 on both
paired pilot iPhones. The iPhone 15 Pro Max was updated in place from Build 75
after exact IPA, signature, production entitlements, and provisioning checks.
No uninstall or development launcher was used. The owner test request is pending;
matching packages do not prove conference connection or two-way media.
