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
device inventory confirmed bundle version 86. On the handset, tapping the avatar
opened the sheet but showed “Could not check profile photo settings.” The same
screen showed that workspace status was unavailable. The client had incorrectly
required `profile.self` (the uncommissioned workspace-status query) before
allowing photo actions, despite the separately commissioned photo capability.

## Build 87 photo-only client correction

Source `89ffeec32df1a162c18202e849a432acc3e4193f` gates photo actions on
the authenticated workspace and `photoCapability`, independent of
`profile.self`. Availability, custom status, and work location remain gated
until their backend is commissioned. The REST upload/delete result updates the
avatar immediately, with a validated owner-and-tenant scoped descriptor saved
locally for app reopen. Picker permission and format errors appear in the photo
sheet. Regression coverage includes stale profile data and a workspace switch
while a photo operation is pending. Thirty-four focused profile tests,
TypeScript, and `git diff --check` passed; independent source review found and
prompted correction of three P2 edge cases before signing.

[Signed workflow 35870250918](https://github.com/vasavas1977/codex-phone11/actions/runs/35870250918)
passed all native, daily-use, PostgreSQL, and iOS build jobs at this exact
source. EAS build `b2f1c260-4981-4bb0-929e-29d7638630bb` used the same
`preview-ios-siprix-daily-pilot` profile and produced Build 87. Its IPA SHA-256
is `113d63efffe426b74e10673dcf2d177f2119e9c2f3f58b8cf00a3dc0af5fab0a`.
The combined native/signature checker passed all 22 signed release checks
against retained Build 49, including disabled OTA updates, production APNs,
Siprix frameworks, and the same signing identity. Build 86 is retained at its
recorded SHA-256. Build 87 was installed in place on the paired iPhone 17 Pro
Max; `devicectl` inventory confirmed bundle version 87. Real photo selection,
upload, second-device rendering, and removal still require handset acceptance.
When `profile.self` is unavailable, this device cannot discover a photo changed
on another device until a separate owner-scoped photo metadata read endpoint is
commissioned; the image fetch itself remains authenticated.

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

## Build 88 chat and Contacts photo rendering

Source `dcbd72e19c233daa799464f1458044be06607d13` shows the confirmed
owner photo in Team Chat and the owner's message rows without relying on the
uncommissioned workspace-status endpoint. Photo changes update mounted views
within the same owner and tenant scope. Team Contacts and contact details use
the directory's authorized photo descriptor and refresh on return; wide
embedded details share the parent's refreshed snapshot. Local phone contacts
use the address book's on-device thumbnail with an initials fallback. Native
thumbnail reads and targeted Expo Contacts cache cleanup are serialized when
address-book access ends. No phone-contact photo is uploaded by this change.

Ninety focused tests, TypeScript, and `git diff --check` passed locally.
Independent source review found and prompted correction of iOS thumbnail
cleanup and mounted Contacts refresh edge cases; the final Contacts review
reported no actionable P0-P2 findings. [Signed workflow 35878231710](https://github.com/vasavas1977/codex-phone11/actions/runs/35878231710)
passed native, app/service, PostgreSQL, and iOS build jobs at the exact source.
EAS build `9417d910-0aab-4308-b959-f1e8b817dc60` used
`preview-ios-siprix-daily-pilot` and produced Build 88. IPA SHA-256 is
`67f5d6febacf9470b8911f3073a443bdacc4e20825928c5d745a3547a104c697`.
The combined native/signature checker passed all 22 signed release checks
against retained Build 49, including disabled OTA updates, production APNs,
Siprix frameworks, and the same signing identity. Build 87 is retained for
rollback. At the time of this entry, installation is pending an unlocked paired
iPhone; source and signed-build checks do not establish handset photo rendering
or native thumbnail cleanup behavior.
