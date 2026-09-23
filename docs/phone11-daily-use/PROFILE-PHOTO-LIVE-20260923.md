# Profile photos: production activation (23 September 2026)

The Phone11 test workspace's profile-photo capability is enabled on the routed
channel API candidate. The existing baseline backend and the `/api/trpc` route
were not replaced. The photo-only Nginx route serves `POST /api/profile/photo`,
`GET /api/profile/photo/:tenantId/:userId`, and
`DELETE /api/profile/photo/:tenantId` from the pinned candidate build
`channel-meetings-9aab162` on port 3006. Route operation
`5103d68c-947a-471e-aa13-456db0fd089d` has a reversible, root-owned
configuration backup under `/opt/phone11ai/profile-photo-20260923` on the VoIP
host. Its active site SHA-256 is
`6ad776e84161d58be0eb37235652c90531c4f5fb4c3bccc4f042fc02a86a189b`.

The dedicated `cp11-profile-photo-worker` container runs the reviewed worker
bundle with no published port and a private shared media mount. Readiness
checked a completed cleanup cycle, its held PostgreSQL advisory lease, zero
restarts, and the exact worker image. The active channel API candidate runs
without its own background cleanup loop; the baseline bundle has no profile
photo cleanup implementation. Check this ownership again before replacing
either image.

The additive schema was applied to the candidate's actual `phone11ai`
PostgreSQL target, not the similarly named local `cp11-postgres` database.
The SQL SHA-256 was
`ba0194ff76b40f9cbd81a95c6e005e43c14e5cc1e44cfb4fda1134eac5b98c26`.
Before application, a root-only custom-format backup was created and restored
twice into isolated PostgreSQL 16 containers. The second restore ran the exact
generated live transaction and checked its catalog before `COMMIT`. Protected
backup, proof, rehearsed SQL, and apply receipt are under
`/opt/phone11ai/profile-photo-20260923/migration-5103d68c` on the VoIP host.
The backup SHA-256 is
`fc6318fd09ba0eb63b1c4f1ef5ee696920ee81927c29f7887a258420af545f66`.
No temporary database credential file remained after application.

Live checks passed: the signed-in test-workspace photo capability returned
`available: true`; an unauthorized tenant was denied; a missing photo returned
404; an invalid image upload returned 400; public HTTPS photo routes reached
the pinned candidate and rejected signed-out requests with 401. Baseline
health and candidate health remained good, and the cleanup worker was running
with zero restarts. Nine focused migration-helper tests and 22 photo-route tests
passed locally. These checks do not prove that a real iPhone photo was uploaded,
rendered on a second handset, removed, and physically cleaned up. Complete
that device acceptance with real accounts before treating the feature as fully
validated across devices.

## Build 86 profile entry correction

Opening Settings → My profile before Team Chat had loaded the selected workspace
could leave the avatar as a static image, with no explanation. Source
`ea05e1903a2a9c09369263db09a37cce3d6b5c3e` loads the selected workspace
on profile entry and keeps the authenticated avatar actionable. The photo sheet
shows a retryable loading or unavailable state until the owner-bound profile
and server capability permit Take photo and Choose photo. Eleven focused tests,
TypeScript, and independent source review passed.

[Signed workflow 35864716395](https://github.com/vasavas1977/codex-phone11/actions/runs/35864716395)
passed its native, daily-use, PostgreSQL, and build jobs for that exact source.
EAS build `05522a41-5879-4297-8f0a-e2527572b64d` used
`preview-ios-siprix-daily-pilot`; its IPA SHA-256 is
`9b5d54c3c49f9c14c178c6554ed586cbec1719e995e6dc25833315f04a8d7ae7`.
The combined native/signature checker passed all 22 signed release checks
against retained Build 49. Build 85 remains retained at its recorded SHA-256.
Build 86 was installed in place on the paired iPhone 17 Pro Max and independent
device inventory confirmed bundle version 86. A remote launch was rejected
because the device was locked; avatar tap, real photo upload, second-device
render, and removal remain handset acceptance checks.

If the photo route must be rolled back, use the reviewed
`scripts/phone11-profile-photo-route.py rollback` with operation
`5103d68c-947a-471e-aa13-456db0fd089d` and the pinned pre-activation site
and Nginx identities. Keep the new tables and deletion queue intact; dropping
them could strand private photo bytes. A future API image containing the
`PHONE11_PROFILE_PHOTO_COMMISSIONED` gate must set that flag only after its
own route, storage, worker, and schema checks pass. The currently deployed
candidate predates that source gate and became available when the schema was
applied.

Membership deactivation currently revokes reads but does not immediately
delete the former member's stored photo. Define and implement the retention
policy before claiming complete offboarding deletion.
