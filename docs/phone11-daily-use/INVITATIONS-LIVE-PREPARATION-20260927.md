# Invitations: live-base preparation, 27 September 2026

## Scope

Invitation source was reviewed at `63203c8910ff09ba59eeb6dfcba1f58c769bface`.
This candidate ports only its backend, HTTP boundary, shared types, pilot
provisioning allowlist, and related tests onto the actually deployed backend
`1a6154d875db87692331b660322fb4545df8b028`. It intentionally does not carry the
other checkout's notification/meeting changes. The web UI remains in the
invitation source checkout for a separate static release.

## Fresh read-only inventory

- AWS account `326786006484`, region `ap-southeast-7`.
- Portal/legacy proxy host: `i-0cc8f248b08c5f2fb`, `43.209.112.208`.
- API/VoIP host: `i-0851dd1ea1cfeef71`, `43.210.122.111`.
- Portal host forwards `api.phone11.ai` to the API/VoIP host.
- Both tRPC locations currently target `127.0.0.1:3013`.
- Voicemail recording HTTP routes also target 3013 and must be preserved.
- Sign-in, mobile config and password-reset routes target 3004; general routes
  remain on 3000. Calling workers are not part of this candidate.
- API Nginx site hash:
  `9bb3907e3b1865260c995be1eab25e4451180e2d9debb375b7f47d2ecb210fe3`.
- Current `cp11-api-candidate-voicemail` container:
  `4ff2de8f0f0e247fc8511c7355ea61d024a063ccff969a1a8e20bc0352451210`.
- Image: `sha256:a357b1b1003caa462ce96a0606a0c3406541056ce86d351e1f21912f55f622be`.
- Bundle: `829c8b9a73d152cdc7df1dd57b1066960ddec223b33cdccfe89df7f8b6dfaeb3`.
- Lockfile label: `24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`.
- Runtime role `api-candidate`, port 3013, voicemail hook false.
- PostgreSQL container: `6ac4827e744d938ee48bb56e0800f2d3cab06a5af47d8466046f671e5c66279a`.
- PostgreSQL image: `sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50`.

The application-path database probe used the same configuration precedence as
`server/pbx/db.ts`, a read-only transaction and a 15-second statement timeout.
It observed database/role `phone11ai`, schema `public`, PostgreSQL 16.13,
two canonical users, zero canonical/auth normalized-email duplicate groups and
zero active identity-bridge email mismatches. Required auth tables were present;
the invitation tables and canonical normalized-email index were absent.
These are preflight facts, not a migration receipt.

The current password-recovery service reports Resend configured with a key and
sender present. Their values were not printed or copied into this document.
No invitation email was sent.

## Validation on the live source base

- Private PostgreSQL invitation/auth/readiness: 91 passed, one existing
  rendered-browser test skipped because `PHONE11_AUTH_WEB_URL` was absent.
- HTTP boundary, mail transport, provisioning and legacy admin: 33 passed.
- TypeScript, backend bundle, and diff whitespace checks passed.
- Existing configured callers return before the new auto-provision allowlist.

## Release sequencing

1. Verify the above runtime pins again; produce a protected backup and isolated
   restore rehearsal for the exact invitation SQL using the application role.
2. Independently review and privately stage the candidate on loopback 3014,
   with invitations disabled, the existing workerless role and hook-off setting.
3. Establish a guarded, invitations-off fallback before invitation activation.
   The unpatched 3013 API is not a safe fallback after new tenant-1 members
   exist: its pilot auto-provision path predates the eligibility restriction.
   Any future tRPC switch must retain that restriction on both active and
   rollback targets. Do not repoint voicemail HTTP, auth, SIP or worker routes.
4. Configure the existing authorized Phone11 Resend sender through a protected
   server-only path; activate only after migration and acceptance checks.
5. Publish the separately verified static web UI, check signed-in administrator
   behavior and test one owner-designated recipient. Provider acceptance,
   recipient receipt, successful acceptance and sign-in are separate evidence.

The SQL uses ordinary CREATE UNIQUE INDEX inside a transaction. Its five-second
lock timeout bounds lock acquisition, not total build time. Measure the restore
rehearsal; do not substitute concurrent-index syntax inside the transaction.
After migration, disable invitations as the operational rollback; retain its
additive tables and audit records. A route rollback alone must not leave new
accounts able to use the old pilot auto-provision path.

## Private staging result

Source `b3ed0e71e1683cd3eca503bee902a221b2c3e3ca` was independently
reviewed and staged on loopback 3014, with invitations disabled.

- Bundle SHA256: `f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2`.
- Image: `sha256:0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d`.
- Container: `3507bfb214e7e76bcf18172dca4b1573491b6a1ec9bce7acc379c7fd5247a229`.
- Health: healthy, API candidate role, build `invitations-off-b3ed0e7`.
- Staging helper: seven focused tests plus thirteen inherited checks passed.
- After startup, all eight baseline container IDs, images, running states,
  Config/HostConfig hashes, and the Nginx site hash matched the before snapshot.
- Public tRPC remains on 3013; no schema migration or email delivery occurred.

Protected operator state resides at
`/var/lib/phone11-invitations-release-20260927` and
`/var/lib/phone11-invitations-api-stage` on the API host.
A healthy private candidate is not proof of signed-in acceptance or delivery.

## Static portal artifact

The separately built production web export uses source
`63203c8910ff09ba59eeb6dfcba1f58c769bface` and the explicit API origin
`https://api.phone11.ai`. It contains 122 files and 72 routes, including
`auth/accept-invitation.html`. The ten emitted JavaScript bundles contain no
fixture or loopback URL origins.

- Local artifact: `/tmp/phone11-invitations-production-web-63203c8`.
- Entry bundle SHA256: `08be2823d632c4f153b8cfc8714b71deb171a91397840af27c8947f099d5f49a`.
- Tree digest: `a48aa19a2bd132865ed29db83ed14ef30eb912abcfb2c5f5a7a7f827b2ebc1ca`
  over sorted relative path, NUL, eight-byte file size, and per-file SHA256.
- Existing static operators target other source revisions; a release-specific
  manifest/operator must be verified against the live predecessor before use.

The owner clarified that the invitation for `vasavasnonsopa@gmail.com` belongs
to the separate **Complete Super Number v7.2 Alpha** task. It is not a Phone11
recipient or authorization to create a Phone11 account. No Phone11 invitation
was sent for that clarification. A Phone11 first recipient remains undesignated;
provider acceptance, receipt, acceptance, and sign-in need distinct live evidence
before marking invitations complete.

## Rehearsal diagnostic

The first rehearsal correctly stopped at catalog ACL parity. Restore now
preserves owners/grants. A second diagnostic identified only relation ACL
representation differences: for example, `active_watchers` had explicit
owner-full privileges in the source and a NULL (built-in owner-default) ACL
after restore. Owners, relation kinds, RLS flags, object counts, and all other
catalog sections matched.

PostgreSQL documents that NULL object ACLs represent built-in defaults,
independent of current `pg_default_acl`:
https://www.postgresql.org/docs/16/catalog-pg-default-acl.html
The corrected comparison expands relation ACLs into sorted role/privilege/grant
tuples. It retains the separate default-ACL, owner, and RLS comparisons and must
still detect additional grants. No live migration was attempted during these
rehearsals; temporary containers were removed after each run.

## Verified restore and migration rehearsal

Rehearsal 05 passed on the production PostgreSQL 16.13 image, using a fresh
protected backup and an isolated resource-limited clone. Migration duration:
0.068 seconds. Effective catalog permissions and existing objects matched
before migration and remained unchanged afterward; expected invitation tables
and indexes passed postflight. The temporary clone was removed.

- SQL SHA256: `0247663e589bba73d542c6a815ebee7081cc7326cc05b47001bdbc181ccaf93b`.
- Backup SHA256: `a0736d4b0d009a723196ecab45375f029c17347daaf6d20fc9e4480da471504c`.
- Source/restored/baseline catalog: `1089dc2dc4fc1d1ca328f7b02c1cf4b288b1723d51f9fd24bdffeada331212a4`.
- After catalog: `82fea678a0764f9ba9addc2fa7898d60cc45d37cc6a6ec9593a5cbc076121387`.
- Operator SHA256: `8c91535699b156beeda04ee2510fcaaa8651af35688fa8cc1babbb487d999a61`.
- Protected receipt: `/var/lib/phone11-invitations-release-20260927/rehearsal-05/rehearsal.json`.
- Ten helper tests passed, including private PostgreSQL checks for equivalent
  owner-default grants and detection of extra PUBLIC table/sequence grants.
- Final check: all eight existing container identities/configurations and
  Nginx routing matched the initial snapshot; no rehearsal clone remained.

## Public feature-off baseline, 27 September 2026

The guarded API and exact static export are now public. Invitations remain
disabled. The live invitation schema and Resend invitation configuration were
not changed, and no invitation email or new account was created.

### API routing

- Independently reviewed route operator SHA256:
  `b85d8b61ad72e558d635661e857254338417a388e56cf489fa23c85e55d769ed`.
- Seven focused operator tests passed. Production prepare and promote passed.
- Both tRPC locations now target the already staged, healthy 3014 candidate.
  Only those two proxy ports changed; voicemail HTTP remains on 3013, auth on
  3004, and every other site byte is unchanged.
- Active site SHA256:
  `bf4a12523f3cacb8c24dde74948271d95773edac3fe3217baefb0104ca562b2c`.
- Protected receipt:
  `/var/lib/phone11-invitations-route-20260927/receipt.json`, SHA256
  `411290645629c7c0dfe5eb6bcb273033060d451bc36eca6c093d4d6a2930fb21`.
- Public availability rejects unauthenticated access with 401; public token
  inspection returns 412 PRECONDITION_FAILED while the capability is disabled.
  Both exact and prefix tRPC base routes reach the API's expected JSON 404.
- All eight baseline container identities, images, running states and complete
  Config/HostConfig hashes still match the before snapshot. Runtime health
  remains healthy where checks are configured. No phone call was placed.

### Static portal

- Source: `63203c8910ff09ba59eeb6dfcba1f58c769bface`.
- Sealed export manifest SHA256:
  `c1703bdc9512a28e473df03a96a6ed9707c7178cab38e88ffd68305437718501`.
- Release marker SHA256:
  `a06e91ed6bf4b2e1d721ff9858b2da57394f717df3413ff6b8ec9cf35d99c13c`.
- Six focused static wrapper tests passed, including archive directory/file
  modes. Release root is 0755 and regular files are 0644, owned by root on host.
- Host prepare, activation dry-run, activation, and rollback dry-run passed.
  Rollback was validated but not applied. Prior release `2b1c2b1` is retained.
- Public marker and JavaScript entry hashes match the reviewed export exactly;
  People, Analytics and invitation-acceptance URLs serve HTTP 200.
- Protected static receipt:
  `/etc/nginx/phone11-static-portal-rollout/63203c8910ff09ba59eeb6dfcba1f58c769bface/receipt.json`,
  SHA256 `f2d9b62ce805bffe4a15b9074c38fa7fed521a4fac9cc2b09d7dfe1c7fb1e767`.
- Portal Nginx site hash remains `e3ca95837a5017913a079059f1cfdc13820c236d09bb8d3a4f35ecc434a4020f`.

Signed-in browser acceptance: People loads both existing members; searching
1020 shows one of two members; the disabled-invitation explanation is visible.
Call analytics loads and its 30-day selector displays recorded data (29 calls).
This verifies page retrieval and interaction, not the completeness of historical
call outcomes or physical-device calling.

Still pending: live invitation schema apply, protected Resend invitation
configuration, capability activation, and delivery/acceptance/sign-in for an
explicitly designated Phone11 recipient. The Super Number recipient is excluded.
