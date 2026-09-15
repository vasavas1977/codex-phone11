# Private SIP-driver reachability

## Current state

The commissioned Cloud Run service cannot reach the local real-SIP driver.
Its configured driver origin, `https://sip-driver.stage.phone11.test`, uses the
reserved `.test` suffix and has no DNS answer. The Google staging project has
no enabled Compute Engine, Cloud DNS, or Serverless VPC Access API, and no
second Cloud Run service. The local fixture metadata is currently absent, so
there is no owned Asterisk container, generated 7101/7102 credential, or 7101
registration to trigger.

`cloudflared` is installed on the lab Mac, but it has no local tunnel
certificate or named-tunnel configuration. `phone11.ai` uses GoDaddy
authoritative DNS, and none of `sip-driver.stage.phone11.ai`,
`sip-driver.staging.phone11.ai`, or `api.stage.phone11.ai` currently resolves.
The AWS credentials visible to this checkout can list only the unrelated
`mvno.1toall.ai` Route 53 zone, so they cannot add a Phone11 hostname.

The driver itself remains appropriately constrained: it binds to loopback,
accepts one exact execution lasting at most one hour, requires a separate
32-byte-or-longer secret, validates the owned Docker fixture and real 7101
registration, and can originate only the fixed synthetic 7101 call through a
deny-by-default dialplan.

## Recommended connection

The first staging L3 run uses a reverse-pull transport through the existing
private Cloud Run service. The local driver runner makes outbound HTTPS
requests to a small authenticated lease endpoint on Cloud Run, receive one
strict scenario envelope, execute it against the loopback fixture, and return
the existing hashed receipt and evidence. This avoids a public driver hostname,
does not open a port on the Mac, and does not require a VPC connector, VM,
static IP, VPN, or third-party tunnel. Cloud Run must remain private, max
instances must remain one, and the runner must use a short-lived Google ID
token plus the existing execution ID and driver secret. A five-second lease and
the current one-hour execution expiry keep failure bounded.

The repository now implements this as
`PHONE11_LAB_SIP_DRIVER_TRANSPORT=reverse_pull`. It exposes only lease and
completion routes under the existing lab namespace; the completion accepts
either the strict receipt or strict evidence for the leased operation. The
service rejects an action until a current runner poll is present and keeps the
direct-HTTPS transport disabled. In-memory rendezvous is sufficient for one
bounded run because the runner keeps the sole Cloud Run instance active; it is
not durable test infrastructure.

A named Cloudflare Tunnel protected by Cloudflare Access is a workable second
choice. It would keep the Mac behind an outbound tunnel, but the current
Cloudflare account/zone, named-tunnel credential, Access service token, and a
real staging DNS hostname are all missing. A Quick Tunnel or raw ngrok URL is
not acceptable because the edge endpoint would be public and would rely only
on application secrets.

## Missing inputs for an L3 run

- Run the owned local fixture to generate new 7101 and 7102 credentials; never
  copy those credentials to Cloud Run or source control.
- Install and launch the exact commissioned Android APK, provision it with the
  generated 7101 credential at runtime, and verify one PBX 7101 contact.
- Grant a dedicated keyless runner identity `roles/run.invoker` on only the
  staging Cloud Run service, and allow the lab operator to mint its short-lived
  ID token. No service-account key is needed.
- Deploy the reverse-pull build, then commission a fresh execution ID, expiry,
  binding ID, APK hash, allowed case, and matching driver secret.
- Replace the placeholder staging database URL with an isolated database and a
  real authenticated Android FCM binding. This is a separate wake-attestation
  gate from driver reachability.

The backend now rejects public Cloud Run origins under `.test`, `.invalid`,
`.example`, and `.localhost`, requires `reverse_pull`, and rejects every
configured driver origin. A future deployment therefore cannot start an
action-capable revision with the currently unreachable reserved hostname.
