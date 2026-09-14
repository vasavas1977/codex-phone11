# Phone11 Android staging cloud runtime commissioning

Verified at `2026-09-14T22:29:39+0700`. Every command named project
`phone11-stage-20260914` explicitly. This record contains public resource
metadata only. It contains no access token, refresh token, API key, service
account key, secret value or FCM registration token.

## Project and billing

| Item | Verified value |
|---|---|
| Project ID | `phone11-stage-20260914` |
| Project number | `413228367517` |
| Project name | Phone11 Android Staging |
| Project state | `ACTIVE` |
| Billing account | `0168D6-64C15C-5340DE` |
| Billing display name | Firebase Payment |
| Billing account state | Open |
| Project billing state after link | Enabled |

The project was previously unlinked. It is now linked to the authorized
billing account above. No budget, payment instrument or billing policy was
changed.

## Enabled APIs

The following requested APIs were enabled and then confirmed in the project's
enabled-service inventory:

- `run.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`
- `iamcredentials.googleapis.com`
- `secretmanager.googleapis.com`

These services provide the bounded Cloud Run build/deploy path, an Artifact
Registry image target, short-lived IAM impersonation and future secret
storage. No Artifact Registry repository, Cloud Build job, Cloud Run service
or Secret Manager secret was created.

## Keyless runtime identity

| Item | Verified value |
|---|---|
| Service account | `phone11-fcm-lab@phone11-stage-20260914.iam.gserviceaccount.com` |
| Display name | Phone11 FCM Lab Runtime |
| State | Enabled |
| Project role | `roles/firebasecloudmessaging.admin` |
| User-managed keys | 0 |

The dedicated runtime identity has exactly one direct project-level role:
`roles/firebasecloudmessaging.admin`. No broad Firebase Admin, Editor, Owner,
Cloud Run administration, Artifact Registry administration or project-level
Secret Manager role was granted to it. A future secret should grant
`roles/secretmanager.secretAccessor` on that exact secret only if the deployed
runtime needs it.

For keyless operator access, `user:vasavas1977@gmail.com` has
`roles/iam.serviceAccountTokenCreator` on this service account resource only.
The service-account IAM policy contains that one binding. The verification
read account and IAM metadata only; it did not mint an access token.

## Boundary retained

This commissioning step did not create or download a JSON key, create a
secret, build an image, deploy a backend, enroll an Android device, mint an
impersonated credential or send FCM. The first provider send remains blocked
until the isolated backend and evidence routes are deployed, authenticated
device enrollment and wake binding succeed, and the exact requested L3 case
has short-lived execution authorization.
