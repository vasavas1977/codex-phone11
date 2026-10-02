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

The diagnostics source is newer than signed Build 114 and has not been
installed or deployed. Both phones have verified Build 114 installations;
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
version before pinning the candidate. The workerless candidate has started on
loopback 3023, with live traffic still on 3016. A separate narrow route operator
is under independent review because the newer mainline authenticated probes
could initialize schema on the baseline. No new authenticated Join, billing
change or physical media acceptance follows from these preparation checks.
