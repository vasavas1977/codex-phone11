# Phone11 CDR replay engine

Source-only recovery component; not installed or scheduled on the PBX.

Run `python3 -B scripts/phone11-cdr-replay/test_replay_worker.py -q`.

The worker preserves every native spool file. It validates URL-encoded XML,
snapshots exact bytes durably, writes intent before sending and accepts only the
qualified CDR receiver acknowledgement. A persisted cursor prevents retained
acknowledged files from starving later entries. Known HTTP 500/503 responses
have at most three attempts with persisted backoff. Timeouts and interrupted
intent require reconciliation; they are not automatically replayed.

The acknowledgement covers the call record, leg and events, not recording
registration or voicemail delivery. Native files contain percent-encoded XML
without the `cdr=` prefix; transport adds that prefix without double encoding.

Production integration still requires bounded authenticated transport to the
verified receiver, current tenant/route authorization, independent producer
completion evidence and service lifecycle qualification. Stable file metadata
alone is not proof that the producer finished. Injected callbacks must be
bounded; the engine cannot preempt arbitrary callbacks. A crashed temporary
state write fails closed for operator reconciliation. No cleanup or retention
policy for original files and durable snapshots is implemented here.

The reviewed source passed 24 offline tests. No customer spool entries were
read or replayed to qualify it. The 60-second trial remains unchanged.
