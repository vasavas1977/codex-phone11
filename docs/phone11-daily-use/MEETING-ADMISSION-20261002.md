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
