# Android staging real-SIP driver

`pnpm lab:android:sip-driver` is the isolated adapter behind `/v1/phone11/real-sip-scenario` and `/v1/phone11/real-sip-evidence`. It is disabled unless every staging gate is present. The process binds only to `127.0.0.1`; an approved staging reverse proxy may provide HTTPS separately.

The service accepts one exact execution UUID, a maximum one-hour expiry, an explicit allowlist of test case IDs, a 32–512 byte driver secret, the fixed `sip:7101@sip.stage.phone11.test` target, and the repository-owned `.lab/fixture.json`. It rejects production targets, arbitrary fixture paths, unknown cases, expired runs, body fields outside the contract, and wrong secret or execution headers.

The adapter validates the fixture's Docker ownership labels and running state, requires a real 7101 registration, and queues the same bounded Asterisk call-file flow used by the Android lab fixture. It then requires a real PJSIP channel and SIP Call-ID. Responses contain SHA-256 hashes of the SIP Call-ID and PBX channel; raw SIP identities, fixture passwords, caller credentials, and provider values are never returned or persisted.

Evidence contains only directly observed driver/PBX events. The driver does not manufacture Android, FCM, notification, answer, or history events, so the upstream live-evidence gate remains failed until those independent sources provide their real observations. The PBX dialplan enforces a 20-second call limit, and the monitor requests hangup only for the exact owned channel if the fixture fails to terminate it.

Required runtime variables are:

- `PHONE11_LAB_SIP_DRIVER_ENABLED=1`
- `PHONE11_LAB_SIP_DRIVER_ENVIRONMENT=staging`
- `PHONE11_LAB_SIP_DRIVER_EXECUTION_ID`
- `PHONE11_LAB_SIP_DRIVER_EXECUTION_EXPIRES_AT`
- `PHONE11_LAB_SIP_DRIVER_CASES`
- `PHONE11_LAB_SIP_DRIVER_SECRET`
- `PHONE11_LAB_SIP_DRIVER_TARGET_SIP_URI=sip:7101@sip.stage.phone11.test`
- `PHONE11_LAB_SIP_DRIVER_FIXTURE_FILE=.lab/fixture.json`
- `PHONE11_LAB_SIP_DRIVER_PORT`

Keep the secret outside source and logs. Start the owned fixture first and do not run another fixture call campaign concurrently.
