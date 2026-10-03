# Phone11 Build 64

[Install from the EAS build-details page](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/da58fb84-970c-49ac-814f-973e17bf5ccc).

![Scan to open the installation page](PHONE11-BUILD-64-INSTALL-QR.png)

Build completed and signed-artifact verification passed on 2026-09-18. Internal release profile: `preview-ios-siprix-daily-pilot`; app version 1.0.0, build 64. Includes the Team Chat retry error-clearing fix. Install over the existing Phone11 app; do not uninstall or use a development launcher.

All 18 checks in `scripts/check-phone11-ios-release.py` passed against its pinned Build 49 baseline, including signature, embedded JavaScript, Siprix frameworks, production APNs, commissioned wake/chat flags, and provisioning coverage. Both pilot handset IDs are in the selected provisioning profile. OTA updates remain disabled; this requires a signed installation.

Team Chat validation: 132 non-database checks plus 37 previously skipped database checks passed. The isolated database runner now runs both chat and notification suites (38 checks including the repeated anonymous-auth check). TypeScript passed.

Still required on the two physical phones: sign in as the existing 3001 and 1020 accounts; send and reply in Team Chat; verify unread clearing; verify a notification while the receiving app is backgrounded; open the notification and verify the intended conversation. Package validation does not establish these device behaviors. Background calling and answer/audio acceptance also remain pending separately.
