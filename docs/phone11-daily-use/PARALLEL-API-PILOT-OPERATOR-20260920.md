# Phone11 parallel API pilot operator

Status: source and hermetic tests only. No candidate image, reviewed pin manifest, production prepare, activation, proxy reload, or rollback was run from this checkout. Activation remains on hold while the protected join credential correction receives independent review; create all credential hashes only after that correction is accepted.

The operator is [`scripts/phone11-parallel-api-pilot.py`](../../scripts/phone11-parallel-api-pilot.py). It leaves `cp11-backend` on port 3000 as the sole owner of SIP wake, chat notification, media retention, recording, ESL, and WebSocket shutdown behavior. It starts a separate `cp11-api-candidate` on host loopback port 3002 and routes only exact `/api/trpc` and prefix `/api/trpc/` traffic to it. The proxy uses `proxy_pass http://127.0.0.1:3002` without a trailing slash, so the full path and query remain intact; Nginx preserves the request method, body, authorization, and cookies.

This candidate-only route does **not** activate Do not disturb suppression for
ordinary chat notifications. Enqueue runs in the routed API candidate, but the
claim and final authorization checks run in the notification dispatcher owned
by the unchanged `cp11-backend` runtime. DND can be claimed only after the
reviewed profile migration and the matching dispatcher code are deployed to
that worker runtime together. Preserve the current baseline until that separate
worker upgrade and rollback have been reviewed; never infer live DND behavior
from candidate API probes alone.

## Required reviewed inputs

The root-owned manifest must be mode `0600`, use schema `phone11-parallel-api-pilot/v1`, and pin all of the following before even read-only prepare can pass:

- exact live `cp11-backend` 64-character container ID, immutable baseline image, normalized runtime fingerprint, and health build;
- exact reviewed candidate image digest, build marker, candidate Compose file hash, and rendered Compose JSON hash;
- SHA-256 of both already-installed protected Connect11 files;
- a separate root-owned `phone11-migration-receipt/v1` receipt with `status: applied`, exact reviewed migration artifact hash, database fingerprint, and verification hash;
- a protected probe bundle containing exactly `existing_phone`, `existing_chat`, `conference`, `mixed_batch`, and `denied_tenant` probes, including their authentication/cookie headers and expected response constraints;
- exact current Nginx site hash, full `nginx -T` hash, and one reviewed insertion marker inside the intended `api.phone11.ai` server block;
- the full Kamailio configuration hash, its path, and the reviewed positive count of direct wake references to `http://127.0.0.1:3000/api/phone11/wake` (four at the last live inspection).

The candidate Compose file must render to exactly one service named `candidate`. It must use container name `cp11-api-candidate`, the manifest image digest, `PHONE11_RUNTIME_ROLE=api-candidate`, explicit `PORT=3002`, the exact build marker, and only `127.0.0.1:3002:3002/tcp`. Privileged mode, host PID/IPC, devices, and added capabilities are rejected. The protected Connect11 values can be referenced through the reviewed Compose configuration; the operator never reports them.

Presence and typing database changes remain separate from conference configuration. Apply and verify only the reviewed backward-compatible migration, then create the migration receipt. Meet can remain unavailable while presence and typing are staged; the receipt records schema readiness and does not advertise conference admission.

## Phases

Run the read-only phase first on the production host as root:

```text
sudo scripts/phone11-parallel-api-pilot.py --prepare --manifest /root/phone11-parallel-api-pilot.json
```

Expected success is `prepare=READY activation=NOT_RUN`. Any missing or stale pin blocks with a redacted stage name. Prepare checks the live container, health, free port, absent candidate, image, rendered candidate configuration, credentials, migration receipt, protected probes, Nginx site and dump, Nginx syntax, and direct wake target. The only local coordination artifact is a root-owned lock file under `/run`; no service or application configuration is changed. All phases acquire that nonblocking lock so competing operators cannot mutate concurrently.

After independent review and the owner's activation decision, activation is explicit:

```text
sudo scripts/phone11-parallel-api-pilot.py --activate --manifest /root/phone11-parallel-api-pilot.json
```

Activation reruns every prepare guard, starts only the candidate service, verifies its exact image/environment/loopback binding and health identity, and runs all protected probes directly against port 3002. It checks the full Nginx dump and site pins again immediately before the proxy write, rejecting intervening edits. Only then does it atomically install the two Nginx locations, syntax-check, gracefully reload, and repeat the probes through the public origin. It finally rechecks both containers and the direct wake target. It never stops, replaces, restarts, or removes `cp11-backend`.

If proxy syntax, reload, public probes, or post-route invariants fail, activation atomically restores the prior site and gracefully reloads it. Both backends remain running so outstanding candidate requests can drain. Manual proxy-only rollback uses:

```text
sudo scripts/phone11-parallel-api-pilot.py --rollback --manifest /root/phone11-parallel-api-pilot.json
```

Rollback accepts only the exact activated site recorded by activation and the exact original site pinned by the manifest. It does not stop the candidate. If rollback itself cannot validate, restore, syntax-check, or reload, the operator reports `rollback_failed`; an operator must then inspect Nginx without changing either backend.

Source tests do not establish a reviewed candidate image, live migration, public routing, conference admission, or two-iPhone media acceptance. The locked-screen/open-app calling and two-way audio checks remain separate release gates.
