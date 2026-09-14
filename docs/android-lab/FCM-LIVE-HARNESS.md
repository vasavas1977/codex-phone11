# Android real-FCM evidence harness

`pnpm lab:test:push:live` is the L3 gate. With no commissioned staging inputs it writes sanitized `BLOCKED` rows for all thirteen L3 matrix cases and exits with status 2. It does not inspect a device, contact a backend or submit a Firebase message in that state. Repeating the same blocked preflight reuses its blocker fingerprint instead of consuming another diagnostic attempt.

An eventual execution requires one short-lived commissioning JSON document and a separate trigger-secret file. The document must bind all of these values together:

- package `ai.phone11.mobile.staging`;
- exact APK SHA-256 and 40-character source commit;
- an isolated staging Firebase project, sender ID and Android app ID;
- an isolated HTTPS backend origin and exact backend source commit;
- FCM HTTP v1 with an attested service-account/ADC project;
- the private lab-only `/api/phone11/lab/fcm-scenario` trigger and `/api/phone11/lab/wake-evidence` read-only evidence routes;
- every requested L3 case and a matching execution UUID that expires within one hour.

The scenario route is deliberately separate from `/api/phone11/wake/offer`. The ordinary offer route is called by the SIP proxy while it holds a real INVITE; calling it directly would manufacture a pending wake without proving a real SIP call. The staging scenario driver must create that real isolated SIP input before it reports acceptance.

The harness validators require independent evidence for exact installed APK/Firebase identity, current FCM token enrollment, an unexpired authenticated wake binding, FCM provider acceptance, the four-field data-only envelope, native receipt, owner validation, notification state and SIP delivery. Case-specific events cover background, locked, forced Doze, process absent, force-stop/relaunch, duplicate/cancel/expiry/rotation/wrong-owner/provider-failure and denied notification/full-screen settings. Simulations, local broadcasts, secret-bearing events, missing timestamps and identity drift are rejected.

Current blockers are expected: there is no commissioned Firebase client file or staging APK, no provider-authorized staging backend, no lab scenario/evidence endpoints, no enrolled token/binding and no short-lived execution authorization. Therefore this harness cannot send or record a PASS yet. The L0 contract lane remains separate.
