# Phone11 channel-meetings candidate at 3006

This is a source-only fixed-topology extension. It does not authorize an image
build, database migration, environment change, container start, Nginx change,
credential use, provider operation, invitation delivery, or handset test.

## Fixed topology

The operator accepts `--channel-topology` only with `--inventory`. It writes a
new `phone11-candidate-bluegreen/v3` manifest and accepts exactly this layout:

| Slot | Container | Loopback port | Required state |
| --- | --- | --- | --- |
| Baseline | `cp11-backend` | 3000 | Healthy and pinned |
| Retained candidate | `cp11-api-candidate` | 3002 | Healthy and pinned |
| Predecessor candidate | `cp11-api-candidate-next` | 3003 | Healthy and pinned |
| Password recovery | `cp11-password-recovery` | 3004 | Healthy and pinned |
| Active settings candidate | `cp11-api-candidate-settings` | 3005 | Healthy, pinned, and the exact current tRPC route |
| Channel-meetings target | `cp11-api-candidate-channel` | 3006 | Absent before activation |

The target is the sole service in Compose project
`phone11-api-channel-candidate`. It is cloned from a fresh protected rendered
Compose source for the live 3005 settings candidate. Only the target identity,
build marker, healthcheck port, and loopback port change. All effective
environment values are carried in memory and never printed.

Inventory rejects an existing target container, an occupied 3006 port, altered
slot name/role/port/service/project, duplicate runtime identity, image-label or
Compose-render drift, an altered Nginx marker, a missing generated recovery
fragment, competing tRPC or recovery locations, and direct competing proxy
destinations on 3003 through 3006. The same route check reads both the protected
site and `nginx -T`: `localhost`, IPv6 loopback, upstream aliases, dynamic
destinations, and decimal spellings such as `:03006` that numerically resolve
to an inactive candidate are refused. It seals the source Compose bytes and
render, protected probe hash, Nginx site and complete dump hashes, Kamailio
hash, image source/bundle/lock labels, and all five existing runtime shapes.

## Activation and rollback boundaries

`--prepare` rechecks every manifest pin, target absence, exact rendered 3005
source, image labels, the current authenticated read probe, Nginx syntax, wake
configuration, and the settings capability contract. The contract requires
`settingsAvailable: true`, `supportedSettings` containing
`businessHoursTimezone`, and a role; it neither requires nor writes a saved
timezone.

Only after those checks can `--activate` start the 3006 target, prove its
health and read-only probes, and replace exactly the two tRPC locations from
3005 to 3006. The generated four 3004 password-recovery locations and shared
marker remain byte-identical. Any failed route verification restores the exact
3005 Nginx bytes. The v3 rollback material is isolated at
`/var/lib/phone11-candidate-bluegreen-channel`; it cannot reuse or overwrite
the v1 or v2 receipts and restores the 3005 route while candidates continue to
run.

## Separate prerequisites

Channel schema work remains a separate guarded operation. The rollout path
requires an independently reviewed migration operator with fresh backup and
restore rehearsal evidence, exact pre/post catalog pins, transaction advisory
locking, bounded lock and statement timeouts, a root-only durable receipt, and
a read-only recovery check. This candidate operator does not run a migration.

For v3, inventory requires two root-only applied migration artifacts: the
independent source-runtime inventory at
`/root/phone11-channel-meetings-migration-inventory.json` and the receipt at
`/var/lib/phone11-channel-meetings/receipt.json`. Their exact SHA-256 values are
sealed into the manifest. The inventory records the live 3005 container ID,
container name, image, loopback port, source release labels, database identity,
pre-migration catalog, and SQL hash. `--prepare` first rechecks the current 3005
runtime, then requires both artifacts to agree on those source-runtime and
database pins before any target or image action. The source runtime is kept
separate from the new 3006 target release, whose image labels remain pinned by
the normal candidate checks. The manifest has one explicit tenant ID, which must
equal the existing protected probe tenant ID. The target environment receives
exactly two additional values:
`PHONE11_CHANNEL_MEETINGS_ENABLED=1` and
`PHONE11_CHANNEL_MEETING_TENANT_IDS=<that one tenant ID>`. The active 3005
environment must have the feature disabled or absent and no nonempty tenant
list. Any other value blocks preparation; the operator neither carries a stale
allowlist nor adds user IDs, permissions, invitations, provider access, or
credentials.

## Source validation

The focused Python suite preserves the v1 and v2 contracts and adds v3 checks
for the fixed six-slot manifest, settings-to-channel clone, five-slot
preservation, target container and port refusal before runtime reads, route
conflict refusal including leading-zero ports, `localhost`, and effective
upstream target aliases, v3 settings capability probe, independent 3005
runtime/database migration evidence and applied-receipt refusal, exact target
feature environment, isolated rollback receipt, exact 3005-to-3006 tRPC
replacement, recovery-byte preservation, and rollback on a post-route failure.
These are source/operator checks only.
