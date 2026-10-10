# PJSIP native SDK packaging

`react-native-pjsip@2.7.4` runs `bash libs.sh` during dependency installation,
including installs for builds that select Siprix. The pnpm patch in
`patches/react-native-pjsip@2.7.4.patch` verifies the native SDK download before
extracting it. Keep this in `pnpm.patchedDependencies`: Phone11's root
postinstall runs after the dependency's own lifecycle and cannot guard that
download in time.

The pinned SDK is the existing upstream release at
`https://github.com/datso/react-native-pjsip-builder/releases/download/v2.7.1-with-vialer/release.tar.gz`:

- Size audited on 1 October 2026: 75,922,176 bytes.
- SHA-256: `edf2d7a37301ffedf3c4eb41e011d4888fd890a278ffea31e4a2a75bd0dc8bee`.
- The audit found 723 members (689 files, 34 directories), with no links,
  special members, or unsafe paths. Every file matched the PJSIP resources in
  the prior immutable Phone11 image
  `sha256:ef120696f0f7cca1aa512b8b334edadbb8826c7cbbcf2919437d99d3530ebace`.

This pin records the audited bytes; it is not an upstream signature or a
physical-device acceptance result. Any upstream archive replacement must fail
installation until its bytes and resource changes are reviewed explicitly.

The patched lifecycle retains extraction into the package directory and the
existing Phone11 native-source patches. It requires `curl`, `tar`, and either
macOS `shasum` or Linux `sha256sum`; uses a fresh temporary download; restricts
the request and redirects to HTTPS; and removes the temporary archive on exit
or interruption. A failed download, failed checksum command, or digest
mismatch exits before extraction and never falls back to `release.tar.gz` in
the package directory.

Run the portable lifecycle checks with
`node --test tests/phone11-pjsip-sdk-checksum.test.mjs`. They apply the patch to
the exact locked-package script and exercise both checksum utilities on small
byte fixtures, including stale archives and failure cleanup. The original pin
was also validated with the audited archive in a separate temporary package
directory, extracting all 723 members successfully. No shared dependency tree,
provider state, installed app, or release artifact was changed by those checks.
