# Phone11 password-recovery additive rollout

This is a source-only operator handoff. It does not authorize a host change,
database write, reset email, provider-key creation, DNS change, or deployment.
The Resend sender domain is verified and the owner-approved dedicated
sending-only key has been placed at
`/root/phone11-password-recovery-secrets.json`; inventory must still pin its
exact protected bytes before activation.

## Boundary

`phone11-recovery-rollout.py` starts one workerless API container on loopback
port 3004 by cloning the effective environment and process settings from the
healthy `cp11-api-candidate-next` service on port 3003. It adds password-reset
configuration from one root-owned mode-0600 JSON file. The key is never accepted
as a command argument, written to the manifest, or printed. The protected
temporary Compose snapshot is removed before activation can continue; a cleanup
failure blocks and removes the new container before any route is exposed.

Nginx receives only these exact locations:

- `POST /api/auth/sign-in/email` (the application blocks other methods)
- `GET /api/mobile/config` (the application enforces the method)
- `POST /api/auth/request-password-reset` (the application enforces the method)
- `POST /api/auth/reset-password` (the application enforces the method)

Credential sign-in moves to the guarded recovery container so password
verification and reset serialize on the same per-user PostgreSQL advisory lock.
Sign-out, `/api/auth/me`, tRPC, calling, Kamailio and the baseline
`cp11-backend` process are not changed. The operator fingerprints the baseline
and the live 3003 candidate before activation and checks them again afterward.

The live candidate must already contain
`https://1toall.phone11.ai` in `PHONE11_AUTH_TRUSTED_ORIGINS`. This exact origin
is the reviewed reset-page callback. A missing origin blocks at
`trusted_origin` before a container is created.

## Protected input

Create the secret file as root at an explicit path outside the release tree,
then set its owner to root and mode to 0600. Its exact JSON shape is:

```json
{
  "schema": "phone11-password-recovery-secrets/v1",
  "provider": "resend",
  "resend_api_key": "REDACTED",
  "from": "Phone11 <noreply@phone11.ai>"
}
```

Do not paste the real key into shell history, a process argument, a manifest, a
ticket, or operator output. Use the existing protected secret-transfer channel.

## Inventory and prepare

After the reviewed image exists by immutable digest, inventory current runtime
state into a new root-only manifest. Example paths are illustrative and must be
replaced with the actual reviewed release directory, image digest and source
SHA:

```sh
python3 /opt/phone11ai/password-recovery-RELEASE/operator/phone11-recovery-rollout.py \
  --inventory \
  --output /root/phone11-password-recovery-RELEASE.json \
  --secret-file /root/phone11-password-recovery-secrets.json \
  --nginx-site /etc/nginx/sites-enabled/api.phone11.ai \
  --release-image sha256:REVIEWED_IMAGE_DIGEST \
  --release-build recovery-REVIEWED_BUILD \
  --release-source-sha REVIEWED_40_CHARACTER_SOURCE_SHA
```

Inventory pins both running containers, the image labels, secret-file hash,
Nginx site bytes and full Nginx dump. It emits only the manifest hash.

Run the non-mutating gate:

```sh
python3 /opt/phone11ai/password-recovery-RELEASE/operator/phone11-recovery-rollout.py \
  --prepare --manifest /root/phone11-password-recovery-RELEASE.json
```

Prepare must return `prepare=READY`. It does not start, replace, reload or remove
a service. Any runtime, image, secret, trusted-origin, port, Nginx or public
baseline drift blocks the rollout.

## Activation

```sh
python3 /opt/phone11ai/password-recovery-RELEASE/operator/phone11-recovery-rollout.py \
  --activate --manifest /root/phone11-password-recovery-RELEASE.json
```

Activation first repeats prepare, then starts only `cp11-password-recovery` on
127.0.0.1:3004. Before routing, it requires auth readiness and
`passwordResetEnabled: true`, `passwordResetAvailability: "general"`. It also
requires every pre-existing `/api/mobile/config` field to remain equal and runs
non-mutating browser preflights for both reset POST routes. A read-only GET to
the exact sign-in path must return the application marker
`X-Phone11-Credential-Serialization: pg-advisory-v1` without credentials or a
database write.

Routing is intentionally two phase. First, only exact credential sign-in moves
to 3004 and Nginx reloads gracefully. The operator snapshots all pre-reload
Nginx worker PIDs and waits at most 30 seconds for every old worker to exit;
those workers cannot exit while they retain an active upstream request. Only
after this drain and the public serialization marker succeed does the operator
publish mobile config and the two reset writes. A second graceful reload and
worker drain removes the mixed-generation window before final public checks.
Each route write rechecks the exact Nginx site and full configuration dump at
mutation time. Baseline read responses and both protected container runtime
fingerprints must remain unchanged.

The operator stores the original Nginx bytes and a root-only durable phase
receipt under `/var/lib/phone11-recovery-rollout` before it starts 3004 or
performs the first route write. The receipt pins the manifest, three exact
route generations, Nginx dumps and baseline-response snapshot; once 3004 is
strictly validated, it also pins the target identity. Every route phase
advances only after its worker drain is complete:

- `pre_container`
- `pre_signin`
- `signin_drained`
- `routed_drained`
- `active`

After process termination or host loss, `pre_container` reentry either starts
an absent 3004 target or adopts an existing target only after its exact Compose
project, service, immutable image, environment, labels and loopback port prove
manifest ownership. Activation otherwise resumes only when the exact receipt,
route bytes, dump and target prove the preceding phase completed. If the bytes
are ahead of the durable phase, the operator treats the drain as unproven and
rolls back instead of publishing the next route generation. Rollback from
`pre_container` removes only that strictly owned orphan and requires the
original route generation to remain unchanged.

A failed post-route check first hides the reset/config routes and drains their
workers, then restores sign-in and drains again before removing 3004. A
committed atomic rename is detected from the bytes on disk and follows the same
recovery sequence before cleanup.

## Rollback

```sh
python3 /opt/phone11ai/password-recovery-RELEASE/operator/phone11-recovery-rollout.py \
  --rollback --manifest /root/phone11-password-recovery-RELEASE.json
```

Rollback accepts only the exact activation manifest, receipt, original,
routed or sign-in-only Nginx bytes, configuration-dump fingerprints and target
container identity. It first removes the config/reset routes while keeping serialized
sign-in on 3004, reloads gracefully, and proves all prior workers drained. It
then restores sign-in to the original route, drains again, and verifies the
recovery marker is absent publicly before removing only the pinned recovery
container. Before removal it durably records `post_original_precleanup`; after
removal it records `rolled_back`. Re-running rollback from either phase safely
finishes the remaining work. An older receipt paired with original route bytes
forces one additional original-to-original graceful reload and worker drain so
container cleanup never relies on unproved process state. It does not restart
or replace `cp11-backend` or either API candidate.

## Remaining acceptance

Source checks and operator readiness do not prove provider acceptance, inbox
delivery, token use, session revocation, handset behavior, or calling. After
activation, run one owner-account request/reset and one unknown-address request
as described in
`PASSWORD-RECOVERY-RESEND-COMMISSIONING-20260921.md`. Confirm the token is
single-use, prior sessions are rejected, responses do not reveal account
existence, and no address, API key, reset URL or token appears in logs.

## Live activation record — 2026-09-22

The guarded backend activation completed on the Phone11 VOIP host with these
immutable pins:

- source: `bbd14cfd66f510d3f486fbc2e65794f51889c1b6`
- backend bundle: `4d3630a668b4fa2d0538321509cd0beefcb6956baeef3c9cf7c163aa2c48bb22`
- lockfile: `24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801`
- runtime image: `sha256:21b31746db0f22295ad5d944d530b2dec4bc70400619cf9e4381bb1011c0fa54`
- operator: `78f810589db3544477343e5d39d05630fa134eaf221c948a0f8bd2103048a133`
- activation manifest: `0b95d7aacb98aeb66ed98041850168bee141f893e9bf2c29f580cd000eb107fb`

Activation reported `routes=4 drains=2`. The active receipt is in phase
`active`; `cp11-password-recovery` is healthy on loopback port 3004 with no
mounts. Public mobile config reports `passwordResetEnabled: true` and
`passwordResetAvailability: "general"`. The public sign-in path returns the
`pg-advisory-v1` serialization marker, both reset routes pass the expected CORS
preflight, and an invalid reset token returns HTTP 400 without echoing the token
or password. The original `cp11-backend` and `cp11-api-candidate-next`
container identities and healthy states remained unchanged.

The root-owned provider file remains mode 0600. The provider key is present
only in the recovery container environment and protected file; it was absent
from the image configuration, Nginx bytes, manifest, receipt, public responses
and checked logs. Resend tracking evidence was the dashboard's absence of a
configured tracking subdomain together with Resend's documented disabled-by-
default behavior until a tracking domain is added and verified; this was not an
explicit provider API boolean readback.

No recovery request email was sent during backend activation. Inbox delivery,
direct-link/no-pixel inspection, token single use, session revocation and the
unknown-address uniformity check remain the commissioning steps above.
