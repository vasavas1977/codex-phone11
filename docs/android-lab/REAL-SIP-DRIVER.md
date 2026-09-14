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

## Private Cloud Run transport

`pnpm lab:android:sip-runner` runs the driver without opening a listener. The
runner polls the IAM-private staging Cloud Run service over outbound HTTPS,
leases one exact correlation, calls the same locally validated driver service,
and uploads its strict receipt or evidence. Cloud Run accepts a completion only
for the current lease UUID, operation, execution, case and correlation. It
keeps ownership of the correlation until `cleanup_completed` is observed or a
bounded timeout expires, so another call cannot overlap the owned fixture.

In addition to the driver variables above, the runner requires:

- `PHONE11_LAB_SIP_DRIVER_TRANSPORT=reverse_pull`
- `PHONE11_LAB_SIP_REVERSE_PULL_ENABLED=1`
- `PHONE11_LAB_SIP_REVERSE_PULL_ENVIRONMENT=staging`
- `PHONE11_LAB_FCM_PUBLIC_ORIGIN` set to the exact private staging Cloud Run URL
- `PHONE11_LAB_SIP_RUNNER_SERVICE_ACCOUNT=phone11-sip-runner@phone11-stage-20260914.iam.gserviceaccount.com`

The operator must be allowed to impersonate that keyless account, and that
account must have `roles/run.invoker` only on `phone11-fcm-staging-lab`. The
runner mints a short-lived identity token for the exact Cloud Run audience and
never prints it. The application also requires the driver secret and execution
ID on every lease and completion. An empty lease is harmless and never touches
Docker; fixture ownership and the real 7101 PBX contact are checked inside the
existing driver immediately before a start operation.
