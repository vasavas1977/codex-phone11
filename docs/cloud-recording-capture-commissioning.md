# Cloud recording capture commissioning

This candidate is **not activated or accepted on a real call**. Importing the code does not connect to FreeSWITCH; new recording requires `PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED=true` and all dedicated configuration values. With complete configuration, startup reconciles existing captures even when the gate is off, to stop and clean previously authorized recorders. No existing legacy recording credentials or default tenant are used.

Implemented: exact persisted authenticated outbound routing and immutable wake-link inbound mapping before capture; administrator off/manual/automatic policy; assigned-user manual RPCs; authenticated ESL both-leg announcement completion, both-direction recording start/stop; private completed-WAV upload with durable leases/retries; acknowledged cleanup of native/spool copies; periodic exact-UUID reconciliation and expired/policy-off stop. The 2-second reconciler is serialized and bounded per batch; it is not an atomic PBX policy transaction.

Required before activation:

1. Apply independently reviewed migration using a fresh backup and rehearsal. Keep capture/AI disabled until their separate acceptance.
2. Verify the deployed FreeSWITCH actually uses the authenticated directory/dialplan callback and trustworthy authentication variables. Verify exact inbound `variable_sip_call_id` maps to the immutable wake link; rewritten or ambiguous IDs fail closed. No number/time matching fallback is provided.
3. Configure dedicated `PHONE11_RECORDING_ESL_HOST`, `PHONE11_RECORDING_ESL_PORT`, `PHONE11_RECORDING_ESL_PASSWORD`, `PHONE11_RECORDING_ANNOUNCEMENT_PATH`, `PHONE11_RECORDING_SPOOL_PATH`, `PHONE11_RECORDING_UPLOAD_URL`, and existing integration `FS_SHARED_SECRET` privately. Restrict ESL reachability. No example credential is a production default.
   Use `infra/configs/freeswitch/prompts/recording-ai-notice-en-male.wav` for
   the English recording-consent announcement. Verify mono 8 kHz signed PCM
   after copying it into the private shared FreeSWITCH prompt volume.
4. Mount the exact private FreeSWITCH recording root into the service filesystem. The adapter provisions private tenant subdirectories under the pre-existing canonical mounted root; verify service/FreeSWITCH ownership permits both recording and cleanup. Confirm private spool directory, capacity and retention cleanup. The adapter refuses missing or symlinked mounts and does not make a remote filesystem writable automatically.
5. Provision the announcement under `/opt/phone11ai/prompts/<name>.wav`. On installed FreeSWITCH, confirm both `PLAYBACK_STOP` events contain the expected `Playback-File-Path` and exact channel UUIDs. Verify `RECORD_STOP` identity/path; fallback reconciliation uses verified channel absence, never a transport error.
6. Run a synthetic real-FreeSWITCH bridged two-leg test: announcement audible on both phones, both directions present in stored WAV, manual permissions and policy-off behavior, stop without hangup, retry after upload response loss, restart with pending capture, expired capture stop, and deletion of both local copies after ready acknowledgment. Current automated tests use a local TCP ESL simulator, not a real media engine.
7. Verify authenticated storage idempotency, exact-token ownership, cloud playback authorization/expiry, and ordinary user denial for another tenant. Manual controls must use server capability information.
8. Independently commission the AI provider/worker. A recorded WAV or configured flag does not prove transcript or summary acceptance.

Limitations: a short call can finish between polling ticks; a failed announcement or missing mapping intentionally prevents capture. Pending-start recovery never repeats an announcement automatically. File cleanup waits for exact subscribed RECORD_STOP plus command acceptance, previously persisted stop proof, or verified channel end before clearing authorization, and failures retain durable retry state. Real media and public-call acceptance remain required.
