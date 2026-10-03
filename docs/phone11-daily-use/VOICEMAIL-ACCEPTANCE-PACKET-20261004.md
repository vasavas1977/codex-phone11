# Phone11 voicemail acceptance packet — 4 October 2026

**PREPARATION_ONLY — blocked on target pins, eligible fixtures and separately
authorized acceptance.** This packet is not an executable deployment approval.
No authentication, API probe, mutation, deposit, migration, route change, storage
commissioning, installation or handset check was performed to prepare it.
Do not enable `PHONE11_VOICEMAIL_HOOK_READY` from this document.

Subsequent source/release addendum: [Build 115](BUILD-115-RELEASE-20261004.md)
finished and passed signed-package and device-coverage checks; installation and
physical acceptance remain deferred. Server-only `194cae9` adds reviewed file
and directory durability barriers before new/replayed acknowledgment, with 22
integrated regression passes. Neither result supplies the missing live target,
writer, deposit or ownership evidence below.

## Source and retained evidence

Prepared from clean integration `8f0306489245bb47dd684670b3953b7b5b8475d7`.
Server deletion correction `8ba5affcc61b54cfa9c1a9e985e2844633eeb254` validates
an optional tenant and returns the actual affected-row boolean. Mobile correction
`b8f9e54597f3fcb32304726c5b9fa82dd4aa1a20` fences actions, pending feedback and
expanded selection to the initiating authenticated owner and operation.
These are independently reviewed **source** changes, not deployed API proof.

| Source file | SHA-256 at preparation base |
| --- | --- |
| `server/pbx/pbx-router.ts` | `0701ccb059092759375bbd095cecc0bca31a60945aac1ed8a5d01bc8ac40d90d` |
| `server/pbx/voicemail-access.ts` | `841f0d1efd7c518ce680e6052e54afe96753c85a1eb1ca19946b12a9e0d7adb6` |
| `app/voicemail/index.tsx` | `b64f157bb8ccda5579ee129440e18ef258f6ec585f581c398a84c34d63c5696e` |
| `tests/phone11-voicemail-callback.test.tsx` | `0c07bdabbdf71b8367d3afae6eaf046e5e2094b4fb1cbd6a8df8e5ab56c67282` |
| `server/pbx/voicemail-storage-migration.sql` | `f24466992eb2902bf85e4c1f1be49dadc18d6d2023511819f3d885b052e79686` |

The [integration record](INTEGRATION-STATUS-20261001.md#4-october-consumer-corrections)
retains 35 focused mobile/caller passes, final TypeScript and independent
`APPROVE_SOURCE_ONLY`. Those checks were not repeated for this packet. The signed
iOS workflow `37142011158` was dispatched for
`1dfda34846d5b002866a6554a2ba74a9012430f7`; dispatch is not package completion.
Build 114 from `d69eede` remains the recorded installed build. It does not include
these later client corrections. Physical testing is owner-deferred.

Desktop-only `64eb19c160b0e139f0e3dc6a93d32abc3335a0fa` is outside that iOS
candidate. Desktop voicemail remains gated pending storage commissioning.
Windows helper/artifact and retained portable trial ZIP custody are verified,
while runtime and distribution acceptance remain unverified; the existing
60-second trial limit remains. See [Windows custody](WINDOWS-ARTIFACT-RETENTION-20261002.md).
Artifact custody is more than source-only evidence and is still not voicemail,
SIP/audio, SDK redistribution or signed-distribution acceptance.

## Missing target pins and prerequisites

| Required before acceptance | Current packet state |
| --- | --- |
| Exact backend source, lockfile/Dockerfile and packaged dependency digests, image digest, running bundle hash, container ID/name, build/role, port and sealed start receipt | Missing for the new voicemail server correction. The historical workerless `7984cee` candidate on loopback 3022 does not establish this contract. Do not reuse its source/bundle receipt for `8ba5aff`. |
| Public origin, current tRPC upstream, exact Nginx site and full-dump generation, dedicated auth/recovery/wake/storage routes; healthy retained rollback image/container and compatibility | Historical receipts exist; fresh action-time pins and admission are missing. No public switch is authorized here. |
| Canonical database/schema, current catalogs, migration ledger/receipts, function definitions, enabled guard/epoch triggers, role/ACL and writer inventory | Missing current voicemail-specific target evidence. Source SQL and earlier clone results do not establish live deployment. |
| Existing approved identities, active memberships, exact tenant/extension/deposit-owner mapping, disposable messages with deposit-time provenance, and protected fixture receipt | Missing for mutation acceptance. Historical observations map 3001/user 1 and 1020/user 2 to tenant 1; revalidate rather than assume. Never assign ownership from the current extension assignee. |
| Eligible active denied tenant, plus an approved distinct non-owner message and revoked-member case | Last recorded target had one active tenant and no eligible active denied-tenant fixture. This remains blocked absent a fresh authorized inventory or separately approved fixture creation. |
| Completed signed candidate, EAS ID, exact IPA SHA/size/bundle version and installed source; both account identities and observed test times | Missing. Retain Build 114 and rollback packages until a separately verified update is installed. |

Use the [existing release plan](EC2-CANDIDATE-RELEASE-PLAN-20260929.md) and
[owned-auth contract](../PHONE11-OWNED-AUTH.md). Ordinary owner-operated sign-in
or the reviewed protected fixture workflow must supply authentication. Do not
extract browser sessions, fabricate actor/tenant headers, reuse credentials from
logs, change passwords or create identities. Secrets, cookies, session headers,
caller details, WAVs and private paths stay out of this packet and public logs.

The mainline route operator accepts only five fixed GET probe labels:
`existing_phone`, `existing_chat`, `conference`, `mixed_batch`, `denied_tenant`.
Its allowlist does **not** include voicemail reads, playback or mutations.
Do not append voicemail to that fixture or weaken its allowlist. Additional
voicemail probes need a separately reviewed, bounded authenticated plan.
The older 3016 predecessor cannot honor its read-only session marker; do not run
authenticated fixture queries there, including during rollback.

The denied-tenant fixture must identify a real active tenant that the actor is
not authorized to access, verified through the reviewed identity/membership
check. A nonexistent tenant's 403 is not active cross-tenant isolation proof.
If none exists, record **BLOCKED**. Creating a tenant, changing membership or
revoking a user requires separate authority and trigger/dependency review;
never invent a substitute fixture to satisfy the route operator.

## Bounded contract checks for later authorization

These are expected observations, not instructions to execute against a target
now. Each case needs its exact source/runtime, approved fixture, test time and
redacted correlation record. No successful empty inbox closes these cases.

| Contract / case | Required observation |
| --- | --- |
| `pbx.voicemail.list` with an explicitly authorized `tenantId` | Only the authenticated deposit owner's non-deleted rows in that active tenant; each row carries the server-resolved `tenant_id`. A different owner in the same tenant receives none of that owner's rows. |
| Mobile returned tenant / legacy rows | Current mobile list supplies no explicit tenant picker input; verify the server-resolved tenant rather than claiming a new picker. Mutations propagate only a valid positive safe-integer `tenant_id` returned with the message. Legacy rows omit `tenantId`, using the existing authorized default resolver. An omitted optional tenant never bypasses membership. |
| `pbx.voicemail.delete` on one approved disposable owned message | `{ success: true }` only when one authorized non-deleted row is changed. Readback excludes that row; independently approved metadata evidence confirms the soft-delete transition and unrelated rows unchanged. This is not proof of WAV erasure. |
| Delete replay / wrong message owner | Repeating that exact delete produces `{ success: false }`, not a second success. A distinct non-owner message in an authorized tenant changes zero rows and returns false. Cross-tenant/revoked membership is refused at tenant resolution; do not require the same refusal shape for every denial boundary. |
| `pbx.voicemail.markRead` | Owned new message transitions once and returns true; an already-read/non-owned message returns false with no unrelated change. Mobile false receipts and rejected requests show safe generic retry feedback, without raw server/private error text. |
| Delete/read failure while expanded | Failed or false delete retains the current authorized expanded selection. No optimistic success or forced player collapse. Authorized inbox reconciliation may remove a deleted row; do not preserve access after authorization loss. |
| Owner A confirmation, then owner B before callback/rerender | Old destructive confirmation submits no mutation. A's selection/pending/error does not appear in B's inbox. Same numeric user with a replacement authenticated owner object also retires the old action. |
| A request in flight, B starts a newer request | Late A success/failure cannot overwrite B pending/success/error or restore A's selection. Unmount retires completion feedback. This is a UI fence, not cancellation of an already authorized server mutation. |
| Playback owner/account revocation | Old-owner playback cannot continue under B or mark B's message read. Require actual protected playback refusal/teardown evidence on the matching signed build; mutation mock tests do not prove native audio or media authorization. |
| Storage missing/mismatched | Fail closed with unavailable service behavior; do not turn missing tables/triggers into an empty successful inbox or fabricate mutation success. Directory writability alone does not prove durable media storage. |

Network delay/failure and account replacement cases need a reviewed isolated
rehearsal or controlled device plan. Do not stall production requests, replace
live transport responses or alter real memberships merely to exercise a race.
Real mutations/deposits require disposable, explicitly authorized fixtures and
separate execution approval. Otherwise retain source-only coverage and **BLOCKED**.

## Schema, producer replay and rollback boundary

The readiness guard checks `voicemail_messages`, `voicemail_deposit_admissions`,
required non-null owner columns and enabled guard/epoch triggers. Before any
commissioning, compare complete target definitions/receipts and role access;
presence of trigger names alone is not proof of the reviewed function body.
An older candidate table must not have owners backfilled from current extension
assignments: quarantine and resolve deposit-time evidence through an approved
operator plan. SQL is never applied at startup or by this packet.

The [PBX release gates](PBX-RELEASE-GATES-20261001.md) separately require accountable
active/rollback extension writers, including host jobs and external clients,
and a protected clone with the relevant access profile before tenant-default
repair/advanced routing. Do not bundle these migrations into a voicemail client
release. Synthetic writer tests and the prior clone without owner/ACL coverage
do not close those prerequisites.

The older [producer contract](VOICEMAIL-PRODUCER-CONTRACT-20260926.md) supplies
mailbox/path and call-flow context; its original two-command/backend-issued UUID
description is superseded by [pending reconciliation](VOICEMAIL-PENDING-RECONCILIATION-20260930.md).
Use the latter's current idempotent admission contract and fixed serialized
runner. Before eventual activation, require the exact active FreeSWITCH image,
runtime, authenticated routing map, private durable source/outbox mounts and
real completed/abandoned/interrupted callback trace. Missing admission, private
acknowledgment or final WAV evidence must not release recording/completion.

Later isolated acceptance must cover lost admission/upload responses, stable
same-UUID retries, owner-epoch rejection after reassignment/toggle, quarantine
and preservation of uncertain WAV/pending evidence. An older backend returning
404 for the idempotent admission path is a refusal, not permission to fall back
to legacy insertion. Age alone must not discard completed evidence. Reviewed
exact-UUID retirement requires the no-final-WAV attestation and must not delete
WAVs/manifests; there is no authorized prune or retention action here.

Before any route rollback, freshly revalidate sealed routing generation,
predecessor/image/container health, unchanged dedicated routes, wake and retained
schema compatibility. Keep additive schema/evidence; no destructive downgrade,
automatic old-auth fallback or producer rollback that parses an unacknowledged
intent as complete. Drift or incompatibility stops the operator for review.

## Evidence receipt required to close acceptance

Record separate results for source review/local tests, hosted CI/signed package,
deployed backend/catalog, protected authenticated reads, authorized mutation
before/after, FreeSWITCH/provider deposit/replay, and physical signed-device
owner playback/account-switch teardown. Each receipt names its own exact source,
artifact/runtime/fixture pins, time, expected/actual result and residual gate.
Private supporting evidence remains in its reviewed protected location; include
only redacted references here. **This preparation closes none of those live gates.**
