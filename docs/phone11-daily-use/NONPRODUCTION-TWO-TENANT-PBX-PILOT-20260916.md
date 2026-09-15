# Phone11 non-production two-tenant, two-DID PBX pilot

**Status: runbook only.** This document does not authorize a database migration, carrier provisioning, telephony configuration, recording, or a customer call. Run it only in an approved isolated environment with two non-customer tenants and two test DIDs.

## Purpose and stop condition

The pilot proves that Phone11 can keep two enterprises isolated while routing a test DID to a direct extension and advanced PBX destinations. It is complete only when every required row in the evidence table is recorded against the same application, schema, Kamailio, FreeSWITCH, and handset versions.

Stop immediately if a preflight reports `incompatible`, an inbound DID can map to more than one tenant, a call reaches a different tenant, two-way audio is missing, the exact running version cannot be identified, or the test number is found to carry customer traffic. Preserve the evidence and do not attempt a routing repair during the test.

## Fixed pilot boundary

| Item | Tenant A | Tenant B |
| --- | --- | --- |
| Workspace | `PBX Pilot A` | `PBX Pilot B` |
| Owner account | dedicated non-production owner | dedicated non-production owner |
| Agent extension | A-1001 | B-2001 |
| Second endpoint | A-1002 | B-2002 |
| Test DID | DID-A, carrier-labelled non-customer | DID-B, carrier-labelled non-customer |
| Allowed callers | two nominated test handsets only | two nominated test handsets only |
| Recording policy | off, unless separately approved | off, unless separately approved |

Never reuse a customer tenant, personal recording, production DID, or a shared administrator account. A human operator must verify that DID-A and DID-B are unique active entries before calls begin. The route service now fails closed if it observes more than one active tenant for an inbound DID; that response is a data-integrity incident, not a signal to retry the call.

## Entry gate

1. Name the environment, change ticket, on-call owner, rollback owner, start and hard-stop time. Record the checked-out application commit and hashes of the intended Kamailio and FreeSWITCH files. Do not use branch names as evidence.
2. Confirm zero active channels, dialogs, and scheduled call jobs. Verify the two DIDs are isolated test routes with no forwarding or customer traffic.
3. Back up the approved non-production database and document the restoration command. This is a review artifact; do not execute it during validation.
4. Grant the operator read-only database access for the preflight and a scoped telephony observer account. Do not place database, carrier, SIP, or API secrets in the evidence record.
5. Run `pnpm pbx:schema:preflight` using only the approved non-production database connection. Save its JSON output without credentials. It must be `ready_for_migration` before the reviewed migration or `compatible` after it. Any other result blocks the pilot.
6. A separate authorized deployment owner may apply the reviewed migration and deploy the exact application and telephony configuration. Rerun the same preflight after deployment; it must be `compatible`. This runbook neither applies nor rolls back a migration.
7. Confirm the exact deployed `/api/kamailio/route` and `/api/freeswitch/dialplan` integration secrets are non-placeholder and that their existing trusted-network boundary is active. Do not reveal their values.

## Object setup acceptance

Use the signed-in Tenant A and Tenant B administrators. Capture API responses, audit entries, and an admin-screen reload for every object below.

| Tenant | Required object | Destination | Negative check |
| --- | --- | --- | --- |
| A | DID-A direct route | A-1001 | B owner cannot list or assign it |
| A | IVR-A | digit 1 to A-1001; timeout to A voicemail/hangup | B owner cannot read it |
| A | Ring group A | A-1001 + A-1002, explicit timeout fallback | B extension cannot be added |
| A | Queue A | A-1001 logged in; short test timeout/overflow | B extension cannot be added |
| A | Business hours A | an open and a closed route using known test time | B owner cannot alter it |
| B | DID-B direct route | B-2001 | A owner cannot list or assign it |
| B | Ring group B | B-2001 + B-2002 | A extension cannot be added |

Do not call unimplemented editors operational. If IVR digit actions, group members, queue agents, route assignment, or schedule exceptions cannot be created and reloaded through a reviewed API or supported admin flow, record the feature as unavailable and omit that scenario instead of creating an ad-hoc SQL route.

## Call matrix

For every successful case, prove ringing, answer, two-way audio, handset hang-up, CDR, and audit correlation. Record the test caller, DID, route target, start/end timestamps, application commit, PBX configuration hashes, and the correlation identifier. Keep media samples out of the pilot evidence unless recording has separate approval.

| ID | Call | Expected result |
| --- | --- | --- |
| P1 | A-1001 to A-1002 | internal call stays in Tenant A |
| P2 | A-1001 to B-2001 | denied; no cross-tenant extension route |
| P3 | test handset to DID-A | A-1001 only |
| P4 | test handset to DID-B | B-2001 only |
| P5 | test handset to DID-A assigned to IVR-A, digit 1 | A-1001 only |
| P6 | test handset to DID-A assigned to Ring group A | A endpoints only; timeout follows configured fallback |
| P7 | test handset to DID-A assigned to Queue A | A logged-in agent only; timeout/overflow follows configured fallback |
| P8 | test handset to DID-A through closed Business hours A | the configured closed route only |
| P9 | disable/remove the target used in P5-P8 | rejected or configured safe fallback; never tenant-wide ringing unless DID explicitly has no route |
| P10 | repeat P3/P4 after tenant switching in each administrator session | no cross-tenant list, edit, CDR, audit, or call delivery |
| P11 | malformed internal FreeSWITCH target and duplicate active DID integrity drill | rejected; no default dispatch |

The only permitted tenant-wide ring behavior is an active DID with *no assigned route*. A missing, inactive, malformed, or cross-tenant assigned target must fail closed.

## Handset and resilience checks

Run P3 and P4 on the exact signed Phone11 build used by both test endpoints:

1. Foreground answer and hang-up.
2. Locked-screen incoming answer, reject, and timeout.
3. Wi-Fi to cellular and cellular to Wi-Fi while connected.
4. Mute, hold, speaker route selection, and recovery after a short background interval, where those controls are enabled in the signed build.
5. Repeat inbound DID calls after an idle interval. Record any call appearance disappearance, duplicate ringing, abrupt disconnect, crash, or missing audio as a failure with the exact timestamps and call identifiers.

Do not claim recording, AI summaries, video, conference, voicemail playback, or notifications from this PBX pilot unless they have their own commissioned test plan and evidence.

## Exit criteria and evidence packet

The pilot may be marked **device-proven for its tested rows only** when:

- schema preflight is compatible and the migration/deployment version is recorded;
- P1 through P11 have their expected result or a documented, accepted unsupported state;
- P2 and P10 prove tenant isolation without relying on hidden UI;
- every route that was enabled has an audit and CDR correlation;
- the observer finds no active route or unexpected call remaining after the hard-stop time; and
- the rollback owner confirms that test objects and DIDs can be detached using the reviewed non-production rollback plan.

Attach only: redacted preflight JSON, deployment identifiers, route object IDs, test matrix results, CDR/audit correlation IDs, handset build identifiers, non-secret log excerpts, and the signed result/rollback decision. A passing source test, admin preview, or carrier order alone is not pilot acceptance.

## Automation that can run before a pilot

These checks are source or isolated-database checks; they do not contact a carrier or alter a PBX:

```sh
pnpm vitest run tests/phone11-pbx-schema-preflight.test.ts \
  tests/phone11-pbx-advanced-migration.test.ts \
  tests/phone11-pbx-admin-authorization.test.ts \
  tests/phone11-pbx-integration-security.test.ts \
  tests/phone11-did-routing.test.ts
```

Set `PHONE11_PBX_TEST_DATABASE_URL` only to the dedicated loopback `phone11_pbx_test` database with an explicit port to exercise the isolated PostgreSQL sections. Those test guards reject other hosts, paths, and URL options. Do not point them at a shared or production database.
