# Phone11 profile/DND aggregate maintenance guard

**Status:** bounded edge and aggregate source prepared, but aggregate readiness
is deliberately blocked by `provider_fence_uncommissioned`. Independent review
and a real provider-session fence remain required. No gate was activated and no
production configuration, daemon, database row, provider or call was changed.

## Architecture decision

The public edge and VoIP host do not have an existing permanent control link.
The VoIP host has `/usr/bin/ssh`, but the root and Ubuntu SSH directories
contain only inbound `authorized_keys`; AWS CLI and an outbound identity are
absent. This source does not add a permanent key, agent or control endpoint.

Maintenance therefore uses two explicit owner-controlled phases through the
existing Mac-to-host temporary EC2 Instance Connect path:

1. Activate the edge gate on the edge host with the edge controller. Record its
   operation UUID, absolute expiry, configuration generation, controller and
   Nginx identities, active-site digest, serving worker PIDs and activation
   digest.
2. Create and pin the aggregate plan from that result. The VoIP-local aggregate
   guard verifies fresh HTTPS responses from that exact edge generation, then
   activates the local Kamailio gate with the same operation UUID and absolute
   expiry. It never changes or releases the edge remotely.

This is coordinated fail-closed maintenance, not an atomic cross-host
transaction. If local SIP activation or aggregate evidence publication fails,
the edge remains closed to new writes until its same owner explicitly runs the
edge release. No controller may infer a remote rollback from a timeout.

## Observed edge contract

The read-only observation on 22 September 2026 found:

- Nginx `1.24.0` on the named edge host;
- `/etc/nginx/sites-enabled/phone11ai` is a symlink to the root-owned
  `/etc/nginx/sites-available/phone11ai`;
- source-site SHA-256
  `e3ca95837a5017913a079059f1cfdc13820c236d09bb8d3a4f35ecc434a4020f`;
- full `nginx -T` SHA-256
  `9f08b86f87a3ca0268f26b29164fca785ad3c95462e5bd9c733eacc121e79c5d`;
- `/usr/sbin/nginx` SHA-256
  `a24def283d640db0bcad3c81b0630a3444b3079f6c50c956c9bd39330eaca544`;
- the `api.phone11.ai` TLS server has one `location /` proxy to the existing
  VoIP host and no specific tRPC or upload location.

These are observation-time inputs, not activation pins. Commissioning must
read them again and stop on drift.

## Edge controller

`scripts/phone11-edge-maintenance-controller.py` is default-off. It derives
three more-specific locations from the exact pinned catch-all proxy body:

- exact `/api/trpc`;
- prefix `/api/trpc/`;
- exact `/api/chat/media/upload`.

Only `POST` receives `503`; non-POST traffic retains the original proxy body.
The response binds the operation UUID, absolute expiry, generation UUID,
deterministic contract digest and serving Nginx worker PID. The contract digest
binds the original site, controller and Nginx executable identities. Activation
atomically writes the candidate, runs `nginx -t`, gracefully reloads, waits for
all predecessor workers to drain, and makes fresh `Connection: close` HTTPS
requests to all three protected surfaces plus a non-POST control.

The root-only activation intent, original bytes, activation and release records
are create-only and fsynced. Status rereads the site and full Nginx dump, requires
the same master start identity and exact worker generation, and repeats the
HTTPS probes. On activation failure, restoration occurs only if current bytes
are still the attempted bytes. A competing writer is preserved and returns
`activation_restore_ambiguous`. Release failure reinstalls and reproves the
gate before returning `release_failed`; an unprovable recovery returns
`release_restore_ambiguous`.

Release publishes a durable root-only compare-and-replace release journal before
removing the gate. Each retry advances that journal to bind the exact active
worker generation before another reload.
Every transition waits for the exact predecessor worker generation to exit
while preserving the Nginx master start identity. Successful release waits out
the gated workers before reporting `active:false`; failed-release recovery waits
out every briefly ungated worker before it may report the gate restored. The
release receipt is part of the guarded transition. If receipt publication
fails, the controller restores and reproves the gate. If the process stops after
the release reload but before receipt publication, the next exact release
command uses the intent to finish the predecessor drain and publish the receipt.

## Aggregate guard

`scripts/phone11-profile-dnd-guard.py` implements the exact
`phone11-profile-dnd-guard/v1` output consumed by
`scripts/phone11-profile-dnd-rollout.py`. The rollout operator was not edited.
Its root-owned mode-0600 plan is itself the immutable fence evidence: the
rollout manifest pins that plan SHA-256.

For `prepare` and `apply-migration`, the guard is read-only and reports the
aggregate fence inactive. Every stopped, restart, replacement and rollback
phase currently stops with the stable stage `provider_fence_uncommissioned`
before acquiring or creating the controller lock, making an edge request,
mutating local SIP state or writing an aggregate record.
It cannot report an active aggregate fence from HTTP/SIP and idle-count evidence
alone.

The prepared post-provider sequence, which remains unreachable until a future
independently reviewed provider mechanism replaces that explicit blocker, is:

1. proves the preactivated edge with nine fresh protected POST requests, one
   non-POST control, the exact contract digest and only the recorded worker
   generation;
2. invokes the exact pinned Kamailio controller locally with the shared UUID
   and the same absolute expiry, while the controller independently enforces
   180 through 1,800 seconds of remaining lifetime;
3. creates an immutable aggregate activation record;
4. requires an all-zero snapshot, waits exactly 15 seconds, then reproves the
   edge, SIP state and all-zero snapshot with zero new attempted notification;
5. creates a separate immutable ready record before it can report the fence
   active.

After provider commissioning, if the first drain window fails, retrying the
activating phase must complete a new full 15-second window; an activation record
alone is never readiness. Every stopped, restart and rollback phase must require
the same aggregate record, edge generation, local SIP activation, provider
fence and unexpired plan. The existing recovery-only `--release-local-sip`
action verifies the edge is still active, releases SIP first and records that
the edge still requires its separate owner release.

Local SIP release creates a durable aggregate release intent before invoking
Kamailio. If the helper response or aggregate receipt is lost, retry reads the
exact immutable Kamailio release record, verifies that SIP state is absent and
finalizes the aggregate receipt. If Kamailio removed the state but did not
publish its own receipt, retry asks the exact pinned Kamailio controller to
reconcile that already-absent state. It never reactivates SIP or infers a remote
edge release.

## Snapshot commissioning gate

The aggregate controller accepts only one root-owned, mode-0700, SHA-pinned
snapshot program. It must return only current timestamps, booleans and aggregate
counts under schema `phone11-profile-dnd-snapshot/v1`; IDs, paths, bodies,
recipients, tokens, environment values and credentials are forbidden.

The existing root-private chat deployment helper is not sufficient. It checks
FreeSWITCH channels, Kamailio dialogs, RTPengine sessions and active SIP
transactions, but it does not cover meeting/provider work, wake states,
recording/capture leases, media work, notification rows or application database
transactions. Read-only inspection confirmed that Kamailio dialog and
transaction RPCs are available. It also found that an unconfigured direct
`fs_cli` call currently fails and the RTPengine container has no
`rtpengine-ctl` executable. The database catalogue contains the expected wake,
plain-video, recording, media and notification tables, but only catalogue
metadata was read; no customer row was queried.

Commissioning must therefore supply and independently review a host-specific
snapshot program that proves all eight aggregate categories and both readiness
booleans using the actual runtime access paths. A guessed FreeSWITCH socket,
missing RTPengine counter, database-only inference or self-reported boolean
blocks staging. The controllers do not manufacture a zero.

That collector still cannot stand in for a provider fence. Cross-project source
inspection at Connect11 source `70734db` found token-capability, token-issue,
eviction and single authenticated-principal eviction-status routes, plus a
customer-scoped HMAC room/identity mapping. It did not find an integrated
Phone11 provider-quiescence helper or API. The available participant listing is
agent-arrival evidence, not a plain-video maintenance fence. Phone11 meeting
leases and pending-eviction counts are control-plane state only.

Plain-video JWTs last 300 seconds and an unexpired issued token can join without
calling the fenced Phone11 HTTP routes. An existing session can also refresh or
reconnect beyond the original token lifetime. Waiting five minutes, observing a
zero pending-lease count or receiving zero provider-session counts at one
instant therefore cannot establish provider admission closure. A future design
must actually fence those issued-token, reconnect and active-session paths and
must provide independently reviewed, operation-bound evidence. No such
interface exists today, so this source intentionally has no configurable or
self-attested bypass for `provider_fence_uncommissioned`.

## Source validation

Run from the repository root:

```sh
python3 -m py_compile \
  scripts/phone11-edge-maintenance-controller.py \
  scripts/phone11-profile-dnd-guard.py \
  scripts/phone11-kamailio-maintenance-controller.py \
  tests/phone11-maintenance-aggregate.test.py
python3 tests/phone11-maintenance-aggregate.test.py
python3 tests/phone11-kamailio-maintenance-controller.test.py
python3 tests/phone11-profile-dnd-rollout.test.py
git diff --check -- \
  scripts/phone11-edge-maintenance-controller.py \
  scripts/phone11-profile-dnd-guard.py \
  scripts/phone11-kamailio-maintenance-controller.py \
  tests/phone11-maintenance-aggregate.test.py \
  tests/phone11-kamailio-maintenance-controller.test.py \
  docs/phone11-daily-use/PROFILE-DND-AGGREGATE-MAINTENANCE-GUARD-20260922.md \
  docs/phone11-daily-use/KAMAILIO-INITIAL-INVITE-MAINTENANCE-GATE-20260922.md
```

The Kamailio 5.8.4 isolated parser result is recorded separately in
`KAMAILIO-INITIAL-INVITE-MAINTENANCE-GATE-20260922.md`. It does not close the
pinned 5.8.8 CI gate, commission SIP traffic behavior or authorize this
aggregate guard.

The parser evidence also predates the absolute-expiry controller delta. That
delta changes only controller input and htable state construction, not the
reviewed Kamailio configuration bytes, but it still requires its own exact-diff
source review before use.
