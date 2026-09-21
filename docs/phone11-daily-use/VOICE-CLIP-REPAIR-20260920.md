# Voice clip repair — 20 September 2026

The owner reported that signed Build72's voice sheet had no clear Cancel action and received voice clips stayed at 0:00 without audible playback (IMG_0858). The paired iPhone was independently confirmed to have Build72 installed.

## Source findings and repair

- Recorder exit was a keyboard icon only. The compact sheet now exposes Cancel, or Close after delivery is committed. Cancellation and unmount invalidate pending recording/upload work; committed messages continue through the chat store.
- Recorder output was sent without minimum-duration or file validation. Short/empty output is rejected; failed uploads retain a retryable local draft. Uploads have a 60-second deadline and cancellation.
- Native playback handed AVFoundation a protected remote URL, while the media endpoint returns a whole-object HTTP200 response without byte-range support. Native media now downloads with authenticated tenant/account headers into a unique temporary file, checks ownership and exact size, and passes the local file to the player. Downloads have a 30-second deadline, cancellation, a 10MiB cap, and cleanup including late completion.
- The iOS playback audio mode was not explicitly restored after recording. Playback now sets silent-mode playback only while holding media ownership, with shutdown ordered before SIP takeover.
- An unloaded player incorrectly displayed 0:00. It now displays Voice message until loaded and offers retry on asynchronous playback failure.

## Verification

- Implementation worker: 130 related tests across nine files; final ten download/cancellation checks; TypeScript; changed-production-file ESLint; diff whitespace check passed.
- Lead: reviewed media transport, ownership, cancellation and delivery boundaries. Real component browser preview checked at desktop and390px mobile width in light/dark themes. Cancel, keyboard-return and Escape dismiss the sheet.
- Existing signed packaging/wake configuration checks:14 passed. Native/config/dependency files remain unchanged.
- Signed release and handset acceptance are separate gates. No claim of audible physical-device success is made from these checks.

## Handset acceptance after signed update

1. Open Team Chat's microphone sheet, cancel, and confirm the conversation remains usable.
2. Hold while speaking for several seconds; release and play on both iPhones, including iPhone silent mode. Confirm actual duration and audible speech.
3. Cancel a recording and a pending upload; neither should create a new message. Close after a message has entered sending; delivery continues normally.
4. Check pause/resume/replay, offline retry, and navigation during loading.
5. During an incoming or active SIP call, chat playback must stop or remain blocked; calling audio must remain usable.

Use only the existing signed internal daily-pilot profile. Never install an Expo development launcher, uninstall the working app, or alter its native identity for this repair.

## Build 79 package evidence — 21 September

The bounded follow-up is in signed Build 79, exact source
`841d2894f415951562fd031107094f84db839aaf`. Its
[successful CI run](https://github.com/vasavas1977/codex-phone11/actions/runs/35554062293)
and EAS internal daily-pilot build
[`61fe406b-2a88-45f8-9337-136d4f1f5889`](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/61fe406b-2a88-45f8-9337-136d4f1f5889)
match that source. Version `1.0.0` / build `79` has IPA SHA-256
`0f7862f85985c87112047fb07454ee38c84e40d141562e2209cb681d9297e9e7`.

The retained IPA passed the native Siprix/bridge/strict-signature gate and all
22 signed configuration/provisioning checks against Build 49. Evidence is at
`~/Library/Application Support/Phone11/verified-builds/79/`. No iPhone was
installed or tested for this build.

This increment only makes keyboard return wait for safe recorder cancellation
before returning focus to the composer, and exposes retry when a clip finishes
with zero duration. Normal Team Chat voice clips already work; no general audio
repair or handset playback success is claimed here.
