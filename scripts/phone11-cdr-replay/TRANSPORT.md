# CDR replay transport integration

This source-only adapter is paired with the SIP-aware replay engine. It has no
command-line driver, daemon or credential loader, and it is not installed on the
PBX. The 60-second trial remains unchanged.

Run the owned loopback fixture tests from the repository root:

```sh
python3 -B scripts/phone11-cdr-replay/test_transport.py -q
```

`transport.py` is byte-identical to the reviewed transport candidate. Its tests
use the worker import path for this directory layout and pin the reviewed
SIP-aware worker (`c93dc545…`). Its ten fixture tests were rerun against that
worker, including acknowledged and unknown delivery outcomes.
`TRANSPORT-REQUIREMENTS.json` preserves the candidate's original requirements,
source hashes and evidence references; its test hash describes the original
candidate test, before the import-path and worker-pin adjustments. The original
`workerUnchangedSha256` is historical evidence, not the current worker hash.

A future reviewed driver can pass `Transport(secret, attest)` as the engine's
transport callback. The secret must come from the existing private integration
binding. The attestor must prove the fixed receiver source and current runtime
before and after the single HTTP attempt, and must honor its supplied absolute
monotonic deadline. The adapter bounds network I/O; it cannot preempt arbitrary
injected Python callbacks.

There is deliberately no callable live driver. Current tenant/UUID/trusted-route
admission, native producer writable-FD completion evidence, private credential
loading and runtime attestation still need production bindings. Stable metadata
and complete XML alone do not prove that FreeSWITCH closed the file. The tests'
true callbacks describe only synchronously closed, self-owned fixtures.

The worker prepends `cdr=` to the exact encoded snapshot without re-escaping.
The adapter validates and transmits that body unchanged. It makes one fixed
loopback request, follows no redirects and performs no internal retries. The engine retains originals and immutable payload snapshots;
known 500/503 responses use its capped durable backoff, while timeout, crash or
ambiguous outcomes require reconciliation. Acknowledgement covers CDR parent,
leg and events; recording registration is separate. No production spool entry,
customer recording or live receiver was read or contacted for these tests.
