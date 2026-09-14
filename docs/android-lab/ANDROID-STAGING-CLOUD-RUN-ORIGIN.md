# Android staging Cloud Run origin

The first deployment uses this canonical origin:

`https://phone11-android-staging-api-413228367517.asia-southeast1.run.app`

Cloud Run defines the deterministic service URL as
`SERVICE_NAME-PROJECT_NUMBER.REGION.run.app`. The service name is
`phone11-android-staging-api`, the verified project number is `413228367517`,
and the region is `asia-southeast1`. Their DNS segment is 40 characters, below
Cloud Run's 63-character limit for deterministic URLs.

Do not derive this service's origin from the hash-based URL of another service.
Cloud Run documents those service identifiers as non-deterministic and subject
to change. The deployment and runtime guards therefore require the canonical
project-number URL in `PHONE11_ANDROID_STAGING_API_PUBLIC_ORIGIN`,
`PHONE11_AUTH_BASE_URL`, and the sole `PHONE11_AUTH_TRUSTED_ORIGINS` value.

After deployment, retrieve the service metadata and verify the canonical origin
directly. A ready service must return HTTP 200 from `/health` with its exact
source commit, HTTP 200 from `/api/ready/auth`, and must continue to reject an
untrusted browser origin with HTTP 403 before the Android APK is rebuilt.

Reference: [Cloud Run service URLs](https://cloud.google.com/run/docs/triggering/https-request#url)
