# Fraud controls storage contract

This is an explicit PostgreSQL contract retaining ten stored policy fields, not a
Drizzle-generated schema. Owner policy: domestic calls remain enabled;
international and premium calls require an admin to enable their flags. The
dynamic backend dialplan guard denies protected calls when no policy row exists.
This statement does not cover static XML or direct-SBC paths; the active routing
topology and fallback behavior need separate commissioning.

`fraud-controls-migration.sql` creates a twelve-column, tenant-owned table without
seeding or changing any tenant row. `tenant_id` is an integer primary key with a
validated tenant FK (`ON DELETE CASCADE`, matching the tenant-owned lifetime).
`international_enabled` and `premium_rate_enabled` are non-null booleans defaulting
to false. `updated_at` is a non-null timestamptz defaulting to CURRENT_TIMESTAMP.
All remaining policy fields are nullable and have no default:

| API input | PostgreSQL column and type | GET wire value |
| --- | --- | --- |
| maxConcurrentOutbound | max_concurrent_outbound double precision | number or null |
| callsPerMinuteLimit | calls_per_minute_limit double precision | number or null |
| dailyCostCeiling | daily_cost_ceiling double precision | number or null |
| internationalEnabled | international_enabled boolean | boolean |
| premiumRateEnabled | premium_rate_enabled boolean | boolean |
| geoBlockList | geo_block_list jsonb | string array or null |
| geoAllowList | geo_allow_list jsonb | string array or null |
| alertEmail | alert_email text | string or null |
| alertOnDailyCeiling | alert_on_daily_ceiling boolean | boolean or null |
| autoDisableOnCeiling | auto_disable_on_ceiling boolean | boolean or null |

The existing snake_case GET shape is preserved; tenant_id is a number and
updated_at follows the existing pg Date / tRPC date serialization. Float8 keeps
fractional JavaScript input values and avoids pg numeric-string output. Range
CHECKs preserve the current 1..100 count API and finite nonnegative cost;
JSONB CHECKs require string arrays; pg decodes JSONB to arrays. The restricted
API writes only the two call-permission flags. The other stored fields remain
readable but supplied limit/geo/alert fields are rejected, never silently dropped
or sent through a privileged fallback. No currency or financial/rate/concurrency
value is invented. This does not establish enforcement of any spending budget,
currency, alerts, geoblocking, rate limit, or concurrency limit.

The distinct `explicitFraudControls: true` management capability promises scoped
GET and UPDATE protocol support for an explicitly selected tenant with a valid
dedicated configuration. It is not live database qualification. GET accepts
optional `{tenantId: number}`; UPDATE accepts optional positive integer tenantId
and at least one of `internationalEnabled` / `premiumRateEnabled`. Unknown fields,
supplied unsupported fields and empty updates fail with BAD_REQUEST. Both use the established selected-tenant
admin resolver: omitted tenant selection is compatible only with one membership;
multiple memberships require an explicit selection. Both use fresh admin authority
and invoke the pinned actor-lock helper on the dedicated lease through commit.
Neither endpoint borrows another tenant's
admin role. The API does not change domestic/internal/emergency routing.

GET is read-only: it returns null for no policy and refuses duplicate or
mismatched/malformed returned tenant identities. A null row lets the admin UI show
false defaults for both call flags; a storage error must leave the UI unavailable,
not present a default as observed stored policy.
A nonempty admin update uses INSERT ... ON CONFLICT under the existing live admin
membership lock and the same leased strict-audit transaction. First configuration
gets false flags for omitted call permissions; conflict updates touch only supplied
flags and updated_at, preserving omitted existing values. Exactly one matching
tenant must be returned before audit. Empty input is rejected without a row or
audit. Audit rejection rolls back first insertion as well as later updates.

The migration owns its transaction and requires a fresh idle connection with
explicit phone11.expected_database and phone11.expected_schema session pins and
that schema already selected. It uses 5s lock / 30s statement timeouts, verifies
ordinary persistent tenants with an integer PK, locks table identities and refuses
non-origin/event-trigger sessions. A row-free temporary native model compares
exact columns, native types/defaults/nullability and CHECKs. Partial, extra,
dropped, reordered or incompatible columns, indexes, PK/FK, policies or user
triggers cause atomic refusal; there is no automatic repair/backfill. The actor
needs temporary-table permission. Existing owners, grants and RLS are never
changed. A compatible table can be rechecked idempotently.

Offline tests cover source guards and the actual API/transaction code with fake
transports. Native migration/default/ABI tests are gated behind an explicitly
selected disposable loopback phone11_pbx_test database. The earlier three-file
PG17 rehearsal passed 43 tests; actual-handler integration has a separate fourth
native file and needs its own current source-bound result. Production migration, grants/readiness, backup/rehearsal,
CI, provider and device acceptance remain separate and unproven.
