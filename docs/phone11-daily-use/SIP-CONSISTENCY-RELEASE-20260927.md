# Phone11 SIP-admin API release operator

The operator `scripts/phone11-sip-consistency-release.py` stages the reviewed
SIP-admin source commit `6180658cfcef558a7f198bcd53aa4da68e3d7cd1` as a
bundle-only overlay on the invitation-enabled API. It routes only the two
public tRPC Nginx locations from loopback 3015 to loopback 3016. The 3015
container remains running as the rollback target. The operator does not
create extensions, reset SIP credentials, change SQL, send mail, or touch the
auth, voicemail, SIP, or worker routes.

## Private release inputs

Install the operator beside the exact checked-in
`phone11-voicemail-api-stage.py` and `phone11-invitations-activate.py` files.
Their SHA-256 hashes are pinned in the operator; altered helpers are refused.
Build `dist/index.mjs` from a clean checkout of the final source commit with
the backend esbuild command in `infra/docker/backend/Dockerfile`. The
`pnpm-lock.yaml` SHA-256 must remain
`24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`.
Do not include the uncommitted release operator in that source checkout.

Place the clean source checkout, bundle, and manifest under root-controlled
directories on the API host. The bundle and manifest must be regular root-owned
0600 files with protected parent directories. The manifest shape is:

```json
{
  "schema": "phone11-sip-consistency-release/v1",
  "predecessor": {
    "container_id": "2d3627f9dc6354ce34f69d9c7dad31493cd04441cb44e5ae86d8f76ea52d28d6",
    "image": "sha256:0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d",
    "source_sha": "b3ed0e71e1683cd3eca503bee902a221b2c3e3ca",
    "bundle_sha256": "f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2",
    "lock_sha256": "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801",
    "build": "invitations-on-b3ed0e7"
  },
  "release": {
    "source_sha": "6180658cfcef558a7f198bcd53aa4da68e3d7cd1",
    "bundle_sha256": "<sha256 of protected final index.mjs>",
    "lock_sha256": "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801",
    "build": "sip-admin-6180658"
  },
  "source_checkout": "/absolute/path/to/clean/source",
  "bundle_file": "/absolute/path/to/protected/index.mjs"
}
```

The placeholder bundle hash and paths must be replaced. Re-inventory the
active 3015 container and Nginx site before preparing; any difference from the
pinned predecessor or site SHA-256 blocks this operator and requires a new
review. Never copy or print the Docker environment: the operator clones it
inside root-private state, retaining the invitation Resend credential and all
other settings except `PORT` and `PHONE11_BUILD_SHA`.

## Phases

Run the following phases as root with the same `--manifest` path:

1. `prepare`: verify the source, bundle, 3015 identity and health, exact Nginx
   site, and free loopback port 3016. Nothing is routed.
2. `build`: create a network-disabled overlay image from the pinned 3015 image.
3. `start`: create only the uniquely named 3016 container and verify exact
   inherited configuration, bundle hash, private loopback binding, Docker
   health, and HTTP `/api/health` build. Nothing is routed.
4. After independent review of the exact operator and a staged endpoint check,
   `activate`: save root-private original Nginx bytes and receipt, replace only
   both public tRPC proxy targets, run `nginx -t`, then reload Nginx.
5. `rollback`: require the same healthy, invitation-enabled 3015 predecessor
   and private receipt, then restore the original two tRPC targets. Rollback
   does not depend on 3016 remaining healthy or present.

The operator's root-private state is
`/var/lib/phone11-sip-consistency-release-20260927`. The existing invitations
`disable` operation must not be used as this release's rollback: it points
new invited users to an invitation-disabled API. If this SIP-admin release is
rolled back, suspend admin extension create and password reset until the fixed
API is restored; the old implementation can recreate the credential mismatch.

The eight offline operator tests pass with
`python3 tests/phone11-sip-consistency-release.test.py -v`. They do not prove
that the current production pins still match or that desktop SIP registration
works. Record staged container health, route hash, public tRPC behavior, and
desktop extension registration separately during a supervised release.
