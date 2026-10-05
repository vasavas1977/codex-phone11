# PBX administrator read revocation — 5 October 2026

This is a source correction, not a deployed API or live-role acceptance record.

A cache fill started before a committed membership change can write its old
administrator value after the mutation invalidates the Redis membership key.
The previous dashboard, audit-log and fraud-control readers used that cached
role alone; a demoted administrator could read until the five-minute cache TTL.
The independent audit reproduced the actual router/resolver/cache/invalidation
path with synthetic DB and Redis transports before the correction.

Five legacy readers now resolve the workspace as before and check current
administrator membership before resource queries, schema probing or analytics/
audit delegation. Their oldest-workspace selection and query filters remain.
The existing selected-workspace read helper also checks current membership;
its explicit selection rule remains. Two redundant endpoint checks were removed.
Mutation and resource-level SQL authorization remain unchanged. This check admits
one request at the membership query; it does not hold a database role lock through
all subsequent reads or revoke data already returned to an admitted request.

The new regression suite runs the real router, tenant membership resolver,
cache fill and invalidation functions. It covers a delayed stale cache fill,
all twelve read paths, demotion/removal, another workspace's unrelated admin
role, current owner/admin success, retained selection/filter behavior and database
failure. All 23 cases passed with zero skips; CI requires this exact nonempty
suite and rejects skipped cases. Five existing adjacent suites plus the initial
20-case version passed 175 cases with seven existing optional DB tests skipped.
Full TypeScript passed after using the existing cached desktop type dependencies.
Scoped ESLint completed with no errors and two pre-existing array-type warnings.
No real PostgreSQL/Redis, membership mutation, authenticated tenant, production
route switch or provider action was exercised. Independent source review and
matching deployed access acceptance remain separate requirements.
