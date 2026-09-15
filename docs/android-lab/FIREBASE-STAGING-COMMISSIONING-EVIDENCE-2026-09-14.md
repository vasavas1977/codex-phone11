# Phone11 Android Firebase staging commissioning evidence

Verified read-only at `2026-09-14T21:36:12+0700` from source head
`696c911c1ad1c9c845838e1655a4906f489e7fe0`. This record contains public
resource identifiers and a configuration checksum only. No access token,
refresh token, API key, or credential value was displayed or recorded.

## Verified staging resources

| Item | Verified value |
|---|---|
| Google Cloud project | `phone11-stage-20260914` |
| Project number | `413228367517` |
| Display name | Phone11 Android Staging |
| Project state | `ACTIVE` |
| Labels | `environment=staging`, `product=phone11`, `firebase=enabled`, `firebase-core=disabled` |
| Firebase project state | `ACTIVE` |
| Android package | `ai.phone11.mobile.staging` |
| Firebase Android app ID | `1:413228367517:android:f41353883923fc15911e74` |
| Firebase Android app state | `ACTIVE` |
| Billing linked | No |

Firebase Management REST returned HTTP 200 for both the project and Android
app listing. The app listing contains one Android app, with the package and app
ID above.

The enabled-service inventory independently returned all three required APIs:

- `firebase.googleapis.com`
- `fcm.googleapis.com`
- `firebaseinstallations.googleapis.com`

No API was enabled or changed during this verification.

## Private Android configuration

The configuration is stored only at:

`.lab/private/firebase/phone11-stage-20260914-google-services.json`

- Git status: ignored by `.gitignore` through `.lab/`.
- File mode: `0600`.
- Size: 699 bytes.
- SHA-256:
  `f60415a409e6be44acd3c35904b545408d88e44cbdcd876b0aee82ccc1a10829`.
- Safe parse result: valid JSON with project ID `phone11-stage-20260914`,
  project number `413228367517`, and exactly one Android client for package
  `ai.phone11.mobile.staging` with app ID
  `1:413228367517:android:f41353883923fc15911e74`.

The file contains one API-key entry as expected for Firebase Android
configuration; its value was not printed or copied into evidence.

## Remaining gates

These resources satisfy the repository's Firebase identity and private-file
requirements. They do not yet prove an operational incoming-call path. Before
any live FCM evidence run:

1. Confirm isolated HTTPS API and SIP staging hosts accepted by the build gate.
2. Provide an approved FCM HTTP v1 sender identity bound to this staging
   project; the current user ADC quota project is different and is not proof of
   sender authorization.
3. Produce and checksum a commissioned `ai.phone11.mobile.staging` APK from an
   exact source commit without committing the Firebase file.
4. Install that APK on the dedicated test device and establish a current FCM
   token, authenticated wake binding, and matching app/session owner.
5. Provide the isolated lab scenario and evidence endpoints plus a short-lived
   execution authorization for the requested L3 cases.
6. Obtain the required action-time authorization before the first provider FCM
   send, then preserve provider acceptance, native receipt, notification, SIP,
   and cleanup evidence separately.

Billing remains unlinked. Confirm that this is intentional before any staging
service that requires billing is introduced; no billing change is needed for
this metadata verification.

## Rollback

The immediate local rollback is to keep both Android commissioning flags off
and remove the ignored private configuration file from the build host. The
ordinary `ai.phone11.mobile.lab` build remains credential-free.

If the staging resources are abandoned, provider cleanup should target only
Android app `1:413228367517:android:f41353883923fc15911e74` and project
`phone11-stage-20260914`. Deleting the app/project or disabling APIs is a
destructive external action and requires explicit owner approval. No such
cleanup was performed for this evidence pass.
