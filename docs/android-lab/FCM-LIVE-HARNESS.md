# Android real-FCM evidence harness

`pnpm lab:test:push:live` is the L3 gate. With no commissioned staging inputs it writes sanitized `BLOCKED` rows for all thirteen L3 matrix cases and exits with status 2. It does not inspect a device, contact a backend or submit a Firebase message in that state. Repeating the same blocked preflight reuses its blocker fingerprint instead of consuming another diagnostic attempt.

## Commissioned client checkpoint

The isolated client prerequisites now exist and have been checked independently:

- Firebase project `phone11-stage-20260914` and Android app `ai.phone11.mobile.staging` exist;
- exact APK `.lab/Phone11-Android-Staging-1.0.0-d908e9c.apk` was built from `d908e9c1a9ed1d41c87b67bdcae386e515953842` with SHA-256 `2824e7daf148ba822a677b8b899a8ec354f9fc056ceac62c5d462a14b0a275e3`;
- the APK verifier found both Phone11 services enabled and non-exported;
- the APK was installed on `emulator-5580`;
- after repairing emulator DNS, the on-device Firebase diagnostic reported token presence with safe fingerprint `50a22f87d237359a`.

The raw FCM registration token was not written to UI, logs or evidence. This checkpoint proves client identity, installation and token acquisition only. It does not prove authenticated backend enrollment, provider acceptance, native receipt or incoming-call presentation.

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

Current blockers start after client token acquisition. The strict scenario/evidence routes and real-SIP driver contract are implemented at source commit `97c8406`, but they are not deployed; there is no authenticated backend enrollment or matching wake binding, no FCM HTTP v1 service-account sender authorized for the staging project, and no short-lived execution authorization. Therefore no provider message has been sent and none of the real delivery cases can record a PASS yet. The L0 contract lane and the commissioned-client checkpoint remain separate from L3 delivery evidence.
