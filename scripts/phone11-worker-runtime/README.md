# Restricted worker source package

The inert factory builds the maintained chat notification and media, recording analysis, retention and capture, and ESL starter graph. The opt-in launcher and the pure rollback evidence checks are also inert on import. Deployment, native admission and old-owner custody belong to an external supervisor.

Run these source and fixture checks from the repository root.

```sh
node scripts/phone11-worker-runtime/build.mjs
node --test scripts/phone11-worker-runtime/test_lifecycle.cjs scripts/phone11-worker-runtime/test_bound.cjs scripts/phone11-worker-runtime/test_runner.cjs
python3 -B -m unittest discover -s scripts/phone11-worker-runtime -v
```

Set `PHONE11_WORKER_PG_BIN` to an existing PostgreSQL 16 or 17 binary directory to include the schema test. It skips when those tools are unavailable. The test creates a private Unix-socket-only cluster and removes it after confirmed stop. The build enforces the existing 40 source pins and extracts the attestation functions verbatim from the retained runtime. The factory leases and verifies the same owned pool before deferred imports and startup. Its application name remains `phone11_retained_runtime`.

## Launcher and ownership

`runner.cjs` binds the exact generated factory by size and SHA-256. Its explicit `--run-bound-worker` entry requires the restricted container UID/GID and one canonical private binding under a held descriptor. The supervisor owns the input and artifact mounts. Private input stays out of output. The launcher owns liveness and signals, waits for startup and close, and stays alive in quarantine if cleanup is uncertain. A late close cannot upgrade quarantine. The factory's own 30-second drain timeout or stopper failure preserves the owned pool pending reconciliation.

After confirmed cleanup, the CLI waits up to five seconds for its terminal stdout write before exiting with the reported code. A failed or overdue write exits with code 70. The supervisor still needs the exact frame to establish a known outcome and holds admission if it is missing.

The supervisor must fence ingress, disable legacy restart, reconcile in-flight, native and external work, and prove the exact old actor absent before every start. A runner readiness frame records same-pool startup and actor dispositions. It does not establish exclusive ownership or release admission. The six explicit dispositions are five booleans and one capture mode (`off`, `cleanup-only`, `enabled`). Disabled actors require no provider keys. `cleanup-only` may still stop or upload recordings and requires a deliberate policy decision. Profile-photo cleanup retains its separate owner.

## Rollback evidence

`rollback_admission.py` evaluates two independently collected, held observations of a known replacement exit before readiness. It requires a complete single-start journal, proven terminal states, owned native and HTTP fences, no restart owners or sessions, and positive reconciliation of durable and external work. Its result carries no dispatch or restoration authority. An unknown start or a possibly issued actor action remains held until independently reconciled. The captured legacy worker did not await all stops or close its pool on SIGTERM, so its exact exit and ownership still require independent proof.

`container_evidence.py` binds the exact original and replacement IDs, definition sections, and complete mount rows. Docker may reorder mounts. The projection sorts them by unique destination. The isolated probe also found the replacement's `HostConfig.OomKillDisable` field reported as present `false` before start and present `null` after exit. The projection admits only those two forms for the replacement and preserves the original field exactly. Terminal `State.OOMKilled` still requires a separate explicit false.

## Schema and rehearsal boundary

Redis serves only the websocket graph's `pbx:events` publication, with finite connect and command limits, shared concurrent first connection, and tracked in-flight closure. A later event can reconnect after a settled connection failure. The worker queues no offline publications and replays no failed events.

`assertWorkerSchema` checks minimum actor-required columns and privileges. It uses a conservative current-column SELECT check for analysis-only mode. The analysis claim, validation and finish SQL use explicit columns and do not require retention's `speaker_identity` UPDATE. Complete ACL, RLS, trigger, default and role containment still require separate verification. The bounded `cloud-columns-additive.sql` transaction adds nullable `capture_stop_requested_at TIMESTAMPTZ` and `speaker_identity JSONB` without default or backfill and refuses incompatible existing definitions atomically. It is a separate schema prerequisite with no runtime invocation or grants.

The isolated AWS worker run exercised the exact generated factory with PostgreSQL 16 TLS, Redis, Docker, systemd, synthetic ESL and loopback admission. Its timings used the earlier frozen launcher. The maintained launcher adds the bounded terminal write, exercised by local child-process pipe tests. The known AWS rollback proof covers a pre-actor refusal. The unknown-start exercise reached held reconciliation and fixture disposal. Native SIP admission, a captured production-equivalent schema and role grant set, recovery after ambiguous actor work, and persistent cold boot remain separate qualification gates. Stage the exact bundle through a reviewed private file path because it exceeds the existing 262,144-byte child-input cap. Production timing remains unmeasured. The trial remains 60 seconds.
