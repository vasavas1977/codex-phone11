# Phone11 Android staging cloud runtime commissioning

Verified through `2026-09-14T23:08:00+0700`. Every cloud command named project
`phone11-stage-20260914` explicitly. This record contains public resource
metadata and sanitized test results only. It contains no access token, refresh
token, API key, service-account key, secret value, FCM registration token,
call identifier, binding identifier or execution identifier.

## Project and billing

| Item                             | Verified value           |
| -------------------------------- | ------------------------ |
| Project ID                       | `phone11-stage-20260914` |
| Project number                   | `413228367517`           |
| Project name                     | Phone11 Android Staging  |
| Project state                    | `ACTIVE`                 |
| Billing account                  | `0168D6-64C15C-5340DE`   |
| Billing display name             | Firebase Payment         |
| Billing account state            | Open                     |
| Project billing state after link | Enabled                  |

The project was previously unlinked. It is now linked to the authorized
billing account above. No budget, payment instrument or billing policy was
changed.

## Enabled APIs and runtime identity

The enabled-service inventory includes the APIs used by the bounded staging
path:

- `run.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`
- `iamcredentials.googleapis.com`
- `secretmanager.googleapis.com`
- `fcm.googleapis.com`
- `firebaseinstallations.googleapis.com`

| Item                | Verified value                                                   |
| ------------------- | ---------------------------------------------------------------- |
| Service account     | `phone11-fcm-lab@phone11-stage-20260914.iam.gserviceaccount.com` |
| Display name        | Phone11 FCM Lab Runtime                                          |
| State               | Enabled                                                          |
| Direct project role | `roles/firebasecloudmessaging.admin`                             |
| User-managed keys   | 0                                                                |

The dedicated runtime identity still has exactly one direct project-level
role. It received `roles/secretmanager.secretAccessor` separately on each of
the three staging secret resources used by the service:
`phone11-lab-fcm-trigger`, `phone11-lab-sip-driver` and
`phone11-stage-database-url`. No secret value was printed or written to this
record.

The first trigger and driver secret versions were disabled after their trailing
line endings made them unsuitable for HTTP headers. Active version 2 for each
contains a header-safe random value, and the running revision resolves only the
active `latest` versions.

For keyless operator access, `user:vasavas1977@gmail.com` has
`roles/iam.serviceAccountTokenCreator` on this service-account resource. No
JSON key was created or downloaded.

## Commissioned Android artifact

The rebuilt staging artifact and installed emulator package matched exactly:

| Item          | Verified value                                                     |
| ------------- | ------------------------------------------------------------------ |
| Source commit | `6ad6133ed0ddf42d2d252dbda9c720fabe006dd1`                         |
| APK           | `Phone11-Android-Staging-1.0.0-6ad6133.apk`                        |
| APK SHA-256   | `872765d51446287f30e73d7e732859467393401a94bde54182dc30f04d317c42` |
| Package       | `ai.phone11.mobile.staging`                                        |
| Installed ABI | `arm64-v8a`                                                        |
| Build flags   | `debuggable=false`, `testOnly=false`                               |

The installed package contained the exact commissioned Firebase identity. Its
native incoming-call and Firebase messaging services were enabled,
non-exported and owned by the staging package.

## First real FCM provider delivery

A single data-only message was sent through the real FCM v1 endpoint with a
short-lived service-account credential. FCM returned HTTP `200`, and the
response was retained only as hashes plus public metadata. The Android native
ingress then recorded one message with a valid four-field envelope shape and
the decision `rejected/rejected_logged_out`.

This proves provider acceptance and native receipt by the exact installed APK.
The logged-out rejection is the intended fail-closed behavior: no wake owner
was authenticated, so the message did not create a call or incoming-call
notification. It does not prove authenticated enrollment, wake ownership, SIP
delivery, answer, connected media or call-history reconciliation.

## Private Cloud Run deployment

| Item                         | Verified value                                                            |
| ---------------------------- | ------------------------------------------------------------------------- |
| Artifact Registry repository | `asia-southeast1-docker.pkg.dev/phone11-stage-20260914/phone11-staging`   |
| Immutable image digest       | `sha256:58ef2a8052c45584917a4940851fac4cabd0db7611ca9c0b7b25d6135c88e676` |
| Cloud Run service            | `phone11-fcm-staging-lab`                                                 |
| Region                       | `asia-southeast1`                                                         |
| Ready revision               | `phone11-fcm-staging-lab-00003-5wd`                                       |
| Runtime service account      | `phone11-fcm-lab@phone11-stage-20260914.iam.gserviceaccount.com`          |
| Authenticated `/health`      | HTTP `200` with the exact source commit                                   |
| Anonymous `/health`          | HTTP `403`                                                                |

The service uses the immutable image digest above, runs the minimal staging
entry point, permits at most one instance and requires Cloud Run IAM before
application-level lab authorization. The authenticated health body reported
the staging project, service name and exact Android source commit.

## Remaining fail-closed gates

The deployed revision is a health-only commissioning checkpoint. The
`phone11-stage-database-url` secret currently contains a placeholder local
database URL, so there is no isolated staging wake database, authenticated
Android enrollment or matching live binding. The configured SIP-driver origin
is also unreachable from Cloud Run; the real SIP driver remains local to the
virtual lab.

These conditions cause scenario attestation and triggering to fail closed. An
authenticated attestation request against the ready revision returned the
generic HTTP `503` staging-unavailable response, confirming that the route does
not accept the fabricated binding while `/health` remains available.
There is no full L3 result yet: no real PBX-triggered FCM wake, background or
locked-device incoming notification, SIP INVITE adoption, answer, connected
audio, termination or history reconciliation has been proven by this cloud
deployment. Full L3 testing requires a reachable isolated staging database
with an authenticated Android binding and a private HTTPS path from Cloud Run
to the bounded real-SIP driver.
