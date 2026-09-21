# Phone11 candidate-only blue/green operator

`scripts/phone11-candidate-bluegreen.py` starts a reviewed workerless API image
as `cp11-api-candidate-next` on loopback port 3003. Activation changes only the
exact and prefix `/api/trpc` Nginx locations from the pinned port-3002 candidate
to port 3003. The port-3000 baseline, calling workers, the port-3002 candidate,
`/api/profile`, and photo migrations remain untouched.

Run every mode as root on the VoIP host. Use the same protected probe bundle
that commissioned the current candidate. Pass its path directly; do not print,
copy, source, or decode its authorization headers. The operator requires a
root-owned mode-0600 probe file, extracts only the authenticated
`phone.getConfig` GET headers in memory, and derives seven GET-only probes,
including tenant identity with explicitly unavailable optional settings. It
never replays the old chat mutations.

Create a pinned, secret-free manifest after the release image is present:

```sh
python3 scripts/phone11-candidate-bluegreen.py --inventory \
  --output /root/phone11-candidate-bluegreen.json \
  --current-compose-file /opt/phone11ai/read-receipts-api-candidate-20260920T092516Z/candidate.compose.json \
  --probes-file /opt/phone11ai/read-receipts-api-candidate-20260920T092516Z/candidate.probes.json \
  --nginx-site /etc/nginx/sites-enabled/phone11ai \
  --release-image sha256:RELEASE_IMAGE_DIGEST \
  --release-build RELEASE_BUILD \
  --release-source-sha FULL_40_CHARACTER_SOURCE_SHA \
  --tenant-id 1 \
  --denied-tenant-id 2147483647
```

Inventory validates the live baseline and candidate roles, stable Compose
render, release labels, exact current Nginx fragment, protected probe shape,
and Kamailio wake configuration. Its stdout contains only readiness and the
manifest hash. The resulting manifest is root-owned mode 0600 and contains
hashes and metadata, not authorization headers or service secrets.

Run the preflight and activation with the same manifest:

```sh
python3 scripts/phone11-candidate-bluegreen.py --prepare --manifest /root/phone11-candidate-bluegreen.json
python3 scripts/phone11-candidate-bluegreen.py --activate --manifest /root/phone11-candidate-bluegreen.json
```

Prepare fails if the inherited credential cannot complete the existing-phone
GET on port 3002, either photo table exists, a pin drifted, port 3003 is in
use, or the target container already exists. Activation validates all seven
read-only probes on port 3003 before routing, then proves the local and public
route markers and repeats the probes. Three public successes are required.

Rollback restores the exact pinned Nginx bytes and verifies both the local and
public route markers point to the port-3002 build. Both candidate containers
remain running:

```sh
python3 scripts/phone11-candidate-bluegreen.py --rollback --manifest /root/phone11-candidate-bluegreen.json
```

This procedure commissions only the workerless tRPC candidate. Profile-photo
HTTP routes remain on the old baseline and the photo tables must remain absent,
so photo capability is required to report unavailable. It is not acceptance
evidence for photo upload, background workers, calling, or handsets.
