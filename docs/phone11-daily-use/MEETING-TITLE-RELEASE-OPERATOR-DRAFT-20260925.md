# Meeting title-label backend release operator (draft, source only)

This draft prepares a guarded move of the Phone11 meeting tRPC route from healthy loopback port 3008 to an isolated candidate on port 3009. **No production action has been taken by this draft.** The operator does not build the image, modify the database, or touch credentials outside cloning the protected runtime environment in memory. It must be independently reviewed before use.

## Pinned baseline and candidate

- Current 3008 container: `cp11-api-candidate-meetings`, image `sha256:d23a97bd859bb2788802fe50debc0d5551a1125d3b879d62277016f41fa0bd22`, running bundle SHA-256 `97770ec21c24ec80f235545ffd66371eb9dd8fd756444578a6af09a5640c2d3b`, health build `meeting-admin-20260925`.
- Current Nginx site SHA-256: `f559523b8963cb7c8b87de301660388af95e2cfb6036c067f0ea6f26fa3cf064`.
- Candidate source: `d67be349fbedbda0d4d441c3e0d958ae1481611a`; bundle SHA-256 `870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e`; health build `meeting-title-20260925`.
- Candidate container: `cp11-api-candidate-meeting-title`, loopback `127.0.0.1:3009`, staging `/opt/phone11ai/meeting-title-20260925`.
- **The candidate image digest is not yet known.** It must be built and reviewed separately. Do not substitute a guessed digest. Both image labels (`com.phone11.source-sha`, `com.phone11.bundle-sha256`) and the staged/running bundle must match the pins above.

## Future reviewed sequence

1. Confirm current route hash, container image/bundle, 3008 health, source staging bundle, candidate image labels and native runtime compatibility. Confirm port 3009 is free. These checks happen in the operators but should be reviewed independently too.
2. After a separately reviewed image exists, run `python3 phone11-meeting-title-release-start.py --image-sha256 <64-lowercase-hex-image-id>` as root on the VoIP host. It clones the pinned candidate runtime to a distinct 3009 container, retaining mounts, network, memory, and protected environment while changing only port/build; it never changes Nginx. On a failed start it removes only the newly created container.
3. Run `python3 phone11-meeting-title-release-route.py inventory`, then `prepare --image-sha256 <same-id>`. Prepare rechecks both containers and health and writes root-only `site.before`, `site.active`, and `receipt.json` under `/var/lib/phone11-meeting-title-release-route`. Inspect the receipt path/hash. No public route changes at this step.
4. Run `activate --receipt-dir <prepared-receipt-dir>` only after review. Activation rechecks the exact original site, the 3008 predecessor, the 3009 candidate, and the receipt. It changes only the two exact `/api/trpc` Nginx `proxy_pass` directives, tests Nginx and reloads. Any validation/reload error attempts to restore the original site; a failed restore requires an operator to intervene before retrying.
5. Verify exact route hash and authenticated title-label behavior, tenant boundaries, and meeting join/leave. A health endpoint alone is not two-device media proof. Keep the healthy 3008 predecessor until this acceptance is complete.
6. To revert an active release, run `rollback --receipt-dir <same-receipt-dir>`. Rollback requires the exact active site and healthy pinned 3008 predecessor, restores only the two tRPC routes from the sealed snapshot, validates and reloads Nginx, then marks the receipt rolled back. If the site or receipt has drifted, stop for manual review.

The old 3008 route receipt is separate from this new receipt. Neither operator should modify the predecessor container or its prior release artifacts. Do not run this sequence until the candidate image digest, current live pins, Nginx configuration, and product acceptance plan have been confirmed at action time.
