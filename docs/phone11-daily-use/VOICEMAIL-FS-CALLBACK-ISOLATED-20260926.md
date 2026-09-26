# Isolated FreeSWITCH voicemail callback probe (2026-09-26)

This is a same-image, synthetic, network-isolated lifecycle check. It is not
a live mailbox deposit or a production upload.

- Image: `safarov/freeswitch:latest`, local image ID `b31c743f4c91`,
  FreeSWITCH `1.10.12-release-10222002881-a88d069`.
- Container: `phone11-fs-callback-probe-20260926`, `NetworkMode=none`,
  synthetic mailbox `9001@probe.invalid`, disposable `/probe` tmpfs. No
  production FreeSWITCH configuration or voicemail volume was mounted.
- The test dialplan calls the candidate Lua hook after setting
  `bridge_hangup_cause=NO_ANSWER`. A fixed test runner records the `admit`
  and `complete` JSON in the disposable `/probe` directory; it makes no API
  request.
- With the old parser, a completed recording produced a valid WAV but
  `durationSeconds:0`. FreeSWITCH's `voicemail_message_len` is formatted
  `HH:MM:SS`, while the old Lua used `tonumber` on that string.
- With the corrected parser, a 3.5-second synthetic caller tone followed by
  caller hangup produced `admit.json` and `complete.json` with
  `durationSeconds:4`. The final WAV was 71,276 bytes at 8 kHz. The callback
  ran after the voicemail application and retained the final private path.
- The answered-call route (`NORMAL_CLEARING`) produced neither admission nor
  completion. An early caller hangup before recording produced admission but
  no completion. That pending admission is intentionally retained for later
  age-gated reconciliation.

The local Lua mock suite covered 12 cases, including formatted durations,
missing and malformed duration, admission failure, and identity mismatch.
Focused producer, relay, dialplan, and storage tests passed 38/38. These
checks establish source and isolated runtime behavior only. Production hook
activation still requires the separate operator gate, backend/migration
checks, supervised producer/relay configuration, and a real call acceptance
test; the live hook remains off.
