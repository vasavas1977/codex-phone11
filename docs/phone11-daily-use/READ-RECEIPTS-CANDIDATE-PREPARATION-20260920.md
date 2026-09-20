# Phone11 read-receipt candidate preparation evidence

Status on 20 September 2026: **ready, finalization deferred**. No candidate
service was started, no migration was applied by this preparation, and Nginx
was not reloaded. The active `cp11-backend` remained healthy on image
`sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`
with its exact container ID unchanged.

The protected stage is
`/opt/phone11ai/read-receipts-api-candidate-20260920T092516Z`. Its immutable
candidate image is
`sha256:cfea5fb61b244bec980211aab4f9d27320f8fd5e2deec2c5d4ae89c3f0f16e91`
with build marker `read-receipts-a0f5c46-0c3c4e227148`. The final preparation
record is `candidate-preparation.json`, SHA-256
`7047bd5fe44e30f8d44745056e274ec82dc334ac74fb1d9fa287dfb41cb06dc3`.
Every protected preparation artifact is root-owned, mode `0600`; the stage is
root-owned, mode `0700`.

## Protected pins

| Artifact | SHA-256 |
| --- | --- |
| Candidate Compose source | `e61e7e5c3320e2478a385d8cfb2db4d206976b9cbf5ba8e9f802aa0b30a7a433` |
| Canonical rendered Compose model | `3685b69f4b07449e8ed50c2af0e5f6ca304f8dd179f23f7a24b8539fb780b31c` |
| Protected five-probe bundle | `2dced6b2717cc688dacfdb62f69ccda95c7880de7e3aab8549682c53da68b54b` |
| Protected fixture checkpoint | `4667559c5da1db8f0505423739bd02065d9ac2207d3cedbf6025a024be07bb21` |
| Nginx site after marker only | `6f1d6e0a5b9805e076f7340abe4ae5b505f0fcac8b280df0d83e82f36bd29c5d` |
| Nginx full stdout dump | `393df373a5d623746f36347acf6b6637c61c80eee2000182f19be56368057a79` |
| Nginx site before marker backup | `38214ef17261f60282cde615a4c69ca15458506372f6918aa93804bb18884331` |
| Active Kamailio runtime config | `700f468517d2644f5f853509263ea365fbf4506b9776fa5646ef1b3a42fa90ac` |

The candidate preserves the five active mounts, four protected environment
file references, and external Docker network. Its effective environment was
compared in protected memory with the running backend and had no unexpected
key or value difference. The intended differences are runtime role, port,
build marker, protected Connect11 mapping, and
`PGOPTIONS=-c lock_timeout=2000ms -c statement_timeout=30000ms`. The active
environment has no `PGOPTIONS`, and its database URL has no `options` query
parameter. The candidate image's deployed `pg` 8.20.0 parsed that exact setting
in a network-disabled, read-only disposable process without opening a database
connection or starting the API.

The Compose health check targets only `127.0.0.1:3002`. Source render, frozen
JSON render, and second render produced the same canonical model. The candidate
container name was absent and port 3002 was free after preparation.

## Pilot fixture and probes

The active runtime's installed Better Auth and Better Call versions generated
the signed bearers in protected process memory. Public `auth.me` returned the
expected numeric identity for pilot users 1 and 2 before any fixture write.
No token, user name, response body, database URL, or provider credential was
written to this record or normal command output.

Exactly one UUID-labelled tenant-1 group and one message were created through
the current public chat API. A targeted verification using only the checkpoint
conversation and message IDs found one group, members `[1, 2]`, and one root
message from pilot user 1 with the pinned client ID and text. The protected
probe bundle contains the five operator labels and binds every chat request to
the matching authenticated owner. Its chat mutation checks the actual service
fields `accepted`, `expiresAt`, and `recorded: 1`; the later query batch checks
that typing is inactive. This remains valid when the same bundle runs directly
and publicly because a repeated typing sequence may correctly return
`accepted: false` while the inactive query remains empty.

`phone.getConfig` is intentionally prepared for `existing_phone` and the mixed
batch but was not called during no-DDL preparation. Its first process call can
run legacy `CREATE/ALTER IF NOT EXISTS` provisioning initialization. It must run
directly against the candidate only after the migration and lock decision,
under the candidate timeouts, and before any proxy change. Its response remains
private. The conference probe expects unavailable because the separate plain
video admission tables are absent.

## Nginx and wake ownership

The only Nginx site change is the reviewed comment immediately after
`client_max_body_size 100m;`:

```nginx
    # PHONE11_PARALLEL_API_INSERT read-receipts-a0f5c46-0c3c4e227148
```

The prior bytes were saved first. `nginx -t` passed and no reload occurred.

The fresh wake pin reads the exact runtime command's file:
`p11-kamailio` runs `kamailio ... -f /etc/kamailio/kamailio.cfg`. That file
contains the port-3000 wake URL once. The earlier observation of four matches
counted the active file plus three timestamped backup files under
`/etc/kamailio`; each contains one occurrence. The operator must pin the active
file hash and count of one. No Kamailio file or route was changed.

Manifest finalization remains blocked until the actual applied migration
receipt is available. Candidate startup, direct/public probes, proxy routing,
and device acceptance remain separate later gates.
