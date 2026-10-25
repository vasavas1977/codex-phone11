# Exact-source DID caller convergence

This source-only renderer corrects the installed DID request and target contract.
It has no command-line entry point, native process control or deployment action.
Production input is private and must never be printed or committed.

The pinned predecessor (`caller-convergence-v1`) verifies the installed main and
include hashes, privately compares the existing backend secret, converts the
query-secret GET into a JSON POST with the authentication header, and denies
HTTP 200 reject/missing-target responses before caching. V2 requires the
separately captured consumer hash, assigns full SIP addresses to `$ru`, retains
location lookup/Flexisip/RTP behavior, and assigns validated internal feature
routes to `$rU`. Its `phone11_did_v2:` cache namespace ignores old generation
keys without flushing the table; malformed entries deny and clear only that key.

SIP target grammar matches the maintained wake-offer schema, including prefixed
and nonnumeric usernames. Internal target grammar follows the maintained pure
encoder. Routing authority comes from the authenticated backend and its tenant
checks, not the regex. Existing cache TTL and non-200 transport fallback are
unchanged. Immediate reassignment revocation is not proved here.

## Validation

Run each Python suite separately because both retain `test_transform.py`:

```sh
python3 -m unittest discover -s scripts/phone11-did-caller-convergence/caller-convergence-v1 -p test_transform.py
python3 -m unittest discover -s scripts/phone11-did-caller-convergence/caller-convergence-v2 -p test_transform.py
node scripts/phone11-did-caller-convergence/caller-convergence-v2/check_encoder.mjs
```

The renderer returns `execution_eligible: false`. Vendor parsing, private live
binding, runtime cache/target qualification and production activation remain
separate work. This commit neither retires the legacy login nor changes a live
route, secret, port, cache or service. Trial calling remains 60 seconds.
