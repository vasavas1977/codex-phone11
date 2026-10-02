# Meeting admission failure

On signed Build 114, Test default-selected extension 1020 and reached a single
Test prejoin. Extension 3001's one Join attempt failed with `Reference: admission`.
Phone11's access log recorded HTTP 412 at 14:42:58 UTC. Connect11's independently
observed existing request recorded capabilities HTTP 200 and tokens HTTP 402
at 14:42:58.881 and 14:42:58.900 UTC respectively. No second Join was performed.

The provider's wallet/trial gate can return `no_billable_wallet`,
`insufficient_balance` or `trial_expired`. The retained Phone11 logs contain
none of these categories. A 402 alone does not distinguish an incorrect billing
mapping from an exhausted wallet or expired trial. Current wallet state also
does not establish the historical request's category without correlation.

The follow-up keeps a constant allowlist of public admission error categories
and validated HTTP statuses. Native setup failures after a successful admission
use a separate stage. Existing ownership checks and classified SDK failures
remain unchanged. Raw errors, provider bodies, credentials and identifiers are
not copied into diagnostics. This change improves fault identification; it
does not remove the provider gate or change billing, admission or permissions.

Lead verification: 152 cases passed across admission, auth-race, prejoin,
channel creation, profile-card and native-session suites. Whole-repository
TypeScript passed. Changed-file ESLint reported zero errors and four existing
prejoin-test warnings; whitespace checks passed. Independent GPT-6.1 Sol high
review approved the frozen six-file source delta with no P0–P2 findings.

The native diagnostics source is newer than signed Build 114 and has not been
installed. The separate server-only follow-up below has its own release evidence. Both phones have verified Build 114 installations;
profile navigation on 3001 passed. Meeting transport and physical two-phone
audio/video acceptance remain blocked. Resolve the exact billing mapping or
wallet/trial condition before another controlled Join; no top-up or billing
change follows merely from HTTP 402.

## Server-only refusal follow-up

The reviewed server patch recognizes only token POST HTTP 402 envelopes with
`error.code: http_error` and one of the three exact categories above. Error
reading is bounded to 4 KiB, 64 chunks and the existing ten-second abort signal.
A provenance-protected diagnostic passes through the tenant provider; the
meeting service logs only a fixed event, category and HTTP status. Public 412
behavior, membership checks, token validation and lease confirmation remain
unchanged. Unknown responses remain generic. No raw body, cause or credential
is logged.

Integration commit: `ad9b0386075601d3e802ce947df2d2558f28fe1a`. Isolated release
candidate: `c5140f4cb0caebce1225b8e45d41c5b9a40af9a9`, based on the actual live
`6180658` plus only five changed files (three server modules and two tests).
[Draft PR 8](https://github.com/vasavas1977/codex-phone11/pull/8) targets that
pinned baseline. Independent GPT-6.1 Sol high review: APPROVE_SOURCE_ONLY.
Root candidate validation: 59 focused tests, lint, backend build and whitespace
checks passed. Full TypeScript fails at `server/pbx/pbx-router.ts:894` with the
same TS2339 on the unpatched baseline; this hotfix does not repair that unrelated
error. No hosted CI result is claimed.

The image extends the immutable deployed image with one backend bundle layer.
Both the base image and candidate actually run Node 22.23.2; the predecessor's
22.22.3 environment metadata is stale. Runtime readback verified the actual
version before pinning the candidate. The workerless candidate was started on
loopback 3023. On 2026-10-02 at 16:25 UTC, the reviewed narrow route operator
activated only the two tRPC directives from 3016 to 3023. The original 3016
process remains running for rollback; baseline worker health stays on its
existing route. The operator uses fixed health and anonymous 401 probes,
because newer mainline authenticated probes could initialize schema on the
baseline. Public probes, exact runtime/image/bundle pins and the sealed active
receipt passed; no authenticated Join or provider request was made by release.

Independent review approved operator SHA256
`fd12361207fcab8dcb3209b5b0cce18d19e61d0d732cca44eace4a4da5f9d553`
after a P2 correction added a five-second total HTTP deadline. Root ran all
22 new regression tests and 30 inherited release tests successfully, including
post-switch deadline failure restoring the exact predecessor configuration.
Active receipt directory:
`/var/lib/phone11-admission-hotfix-release-route/20261002T162437Z-e131fc321a0653319cfa05642a9d22f5d48bb14149c4d212c1ab27b1c47dfca2`.
Site SHA256 changed from
`aa31a27c3d65a0167fb3f8d2aca08b059f86cbec824c0777e73b278169737485` to
`1eebf1ec8738be9b585a68ad031e188bb3a8aede41d9d4f4fff085843accbe86`.

The subsequent human retry failed with Reference: admission. Bounded redacted
capture identified `trial_expired`, HTTP 402, with three recorded refusals from
2026-10-02T16:37:13.016348966Z through 16:37:38.045494457Z. This establishes the
provider gate category, not whether the durable account is genuinely unconverted
or the serving process has stale trial/top-up state. Exact owner-scoped durable
state and serving-process correlation are under read-only investigation with
Connect11. The diagnostic does not repair wallet/trial state. No billing change
or physical media acceptance is established by these release checks. The capture
itself performed no provider requests. Hosted integration checks passed at
`1b128a2c3dd484eec802aa98fee6d5834aacb5ba` (14 checks); those are distinct from
the isolated hotfix's local tests and its PR, which has no hosted CI result.

## Prejoin error wording correction

The signed Build 114 error headline advises checking the connection even when
its typed failure stage is admission. The reviewed two-file source correction
selects fixed wording only from the existing `MeetingJoinFailure` stage/reason.
Recognized admission/unavailable uses availability and administrator guidance;
unknown admission remains neutral; local setup uses device preparation wording;
only signal connection retains connection advice. Raw messages, provider bodies
and billing reasons never select user-facing copy. Redacted references, join
preferences, duplicate-join guards and media/session lifecycle remain unchanged.

Root reran all 74 focused prejoin/classifier/conference-auth-race tests, passing.
Builder TypeScript and changed-file lint passed (four existing test warnings).
Independent GPT-6.1 Sol high review: APPROVE_SOURCE_ONLY, no P0–P2 findings.
This is a source correction, not an installed update or billing repair. Build114
still has its previous headline; successful meeting connection is unverified.

All 14 hosted checks passed for the correction at
`e8145ad6ea6515bd9295ceb74f053b94fa041318`. No newer native build was installed.

## Current credential binding readback

On 2026-10-03 (Bangkok), the lead verified the running Phone11 candidate's
meeting configuration against its protected configuration and credential
metadata. The canonical account was pinned to the existing installer's owner;
roles, scopes and namespace matched. The readback exported only protected
identifiers and derived credential hashes to a private proof, never bearer
values, and made no provider or authenticated Join requests.

The standalone reader passed 12 offline tests and independent GPT-6.1 Sol high
source review before execution. Its reviewed SHA256 was
`567b6fd66b41a459096030ae057f1f90b1c6465fd2df07b6406d85fa0711ff67`.
This confirms current Phone11 configuration custody. Durable Connect11 key
binding and trial/top-up state were subsequently checked by the separate
reviewed database diagnostic below. Meeting recovery remains unverified.

## Verified current durable billing state

The single standalone read-only diagnostic completed on 2026-10-03 (Bangkok).
It verified the current effective credential's durable key/account/namespace
binding, exactly one owner wallet and exactly one trial, TLS certificate and
hostname verification, and a read-only repeatable-read transaction. The trial
expiry was present, supported and past the observation time. Its stored status
was `active`, but it was unconverted, had no conversion timestamp, and the unique
durable owner wallet had no `TOPUP` entry. This supports the current trial-gate
rejection; no existing durable top-up was found for a stale-cache repair.

The operator used one task-launch attempt with SDK retries disabled and a
protected attempt record. Actual image/network/definition and zero exit status
passed, and terminal task cleanup was verified. All 70 offline packet, renderer,
diagnostic and operator tests passed before execution, with separate independent
GPT-6.1 Sol high reviews. No application startup, schema change, provider Join,
payment, credit, trial grant or billing-gate change was performed.

This snapshot does not prove the historical process-selected wallet or cache,
past admission, payment provenance, a SELECT-only database role, or device/media
success. An absent recorded top-up does not prove no payment was made. The next
action is legitimate funding or reconciliation of an existing payment for the
exact Connect11 service account/wallet bound to Phone11. Funding a different
personal console account would not resolve this binding. Do not bypass the gate
or manufacture a paid top-up from trial/adjustment credit.
