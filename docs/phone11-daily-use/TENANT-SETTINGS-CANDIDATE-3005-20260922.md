# Phone11 tenant-settings candidate at 3005

The reviewed tenant-settings candidate is live at port 3005. This record binds
that bounded release; it does not establish an authenticated timezone write,
cross-tenant acceptance, provider delivery, handset behavior, or delivery of
other optional management domains.

## Fixed topology

The existing v1 blue/green path remains unchanged for its original `3002 → 3003` topology. The new `phone11-candidate-bluegreen/v2` manifest is selected only by `--settings-topology` during inventory and accepts one exact topology:

| Slot | Container | Loopback port | Required state |
| --- | --- | --- | --- |
| Baseline | `cp11-backend` | 3000 | Healthy and pinned |
| Retained candidate | `cp11-api-candidate` | 3002 | Healthy and pinned |
| Current tRPC candidate | `cp11-api-candidate-next` | 3003 | Healthy, pinned, and the current exact tRPC route |
| Password-recovery candidate | `cp11-password-recovery` | 3004 | Healthy and pinned |
| New settings candidate | `cp11-api-candidate-settings` | 3005 | Must be absent before activation |

The v2 target service is `candidate_settings` under Compose project `phone11-api-settings-candidate`. Inventory rejects a changed slot name, port, role, service, project, already-present target, an occupied 3005 port, a missing or altered exact four-location recovery fragment, image-label mismatch, Compose/render drift, or a nonexact 3003 tRPC fragment. Its route check reproduces the deployed operator sequence exactly: the two tRPC locations were inserted at the shared marker first, then the password-recovery operator inserted its four exact locations at the still-shared marker. The accepted byte order is therefore tRPC, recovery, marker. After removing that one exact six-route fragment, a comment-aware Nginx token check rejects any additional exact, prefix, nested, or regex tRPC location, any additional known recovery path, and any remaining proxy destination on 3003 or 3004. Comments and non-directive header text do not count as routes. The fixture is generated with the real recovery operator helper rather than a separately invented route layout. The operator clones only the pinned 3003 service and changes only its target identity, build marker, healthcheck port, and loopback port to 3005.

Rollback evidence is intentionally separate from v1: v2 writes only under `/var/lib/phone11-candidate-bluegreen-settings`. Its receipt pins the v2 schema and `settings-3003-to-3005` topology, so a legacy v1 receipt cannot be reused.

## Applied release evidence — 22 September 2026

The protected v2 manifest SHA-256 is
`73b1d0e9a3aabf7b4dc38aa177294fa399a67da35fa3dbab5f266b108a078bd2`.
Activation passed with tRPC routed to the new settings candidate at port 3005;
the baseline remained unchanged and photos remained unavailable. Its isolated
rollback receipt at `/var/lib/phone11-candidate-bluegreen-settings/receipt.json`
has SHA-256 `2119c72773f4086882afcb4f72b1a08afa5fa0f5ad42258e656b31fba245fe35`
and binds topology `settings-3003-to-3005`, target container
`cp11-api-candidate-settings`, target build `settings-9804c2f`, and separate
pre-route/active Nginx bytes.

The live settings image is
`sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9`,
with source `9804c2f09f99453747e0bb54e23d3b6149f5b5cb`, bundle SHA-256
`20e717154637803d1205498c994ebcb22028fdc4ec71095fcc21737507501121`, and
lock SHA-256 `24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`.
Fresh readback found the 3000 baseline, retained 3002 candidate, prior 3003
candidate, recovery 3004 candidate, and settings 3005 candidate healthy on their
expected loopback bindings. The active Nginx-site SHA-256 is
`5ca6f02888887cc4d0f0719bffba0a74187d55abc008d6b65c272fe2ab3cd8db`; the
Nginx stdout dump SHA-256 is
`2c85756c25c5fb97b788d81c91a6c98c462db2a2a76c6650ad7f237ab9603c71`.

The activation's read-only capability probe required
`settingsAvailable: true`, `supportedSettings` containing
`businessHoursTimezone`, and a role. It did not require or create a saved
timezone. The post-activation browser check covered only the signed-out
workspace-settings owner/admin gate; no authenticated setting write or readback
was performed.

## Source validation

The focused Python suite preserves the eleven v1 checks and includes fifteen v2 checks for fixed topology admission, 3003-to-3005 cloning, preservation of all four existing runtime slots, 3005 absence, v2 inventory selection/sealing, recovery-operator-generated route order, competing prefix/nested/regex and fifth-recovery-route rejection, comment/lookalike handling, exact recovery-byte preservation during activation, receipt separation, and the migrated schema-capability probe before any route change. The exact final operator delta received independent source-only approval before this production operation.
