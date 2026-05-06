# Phone11 Native Mobile Build

Phone11 Cloud Phone cannot be tested in Expo Go. The mobile app uses native SIP and native calling modules, so every serious call test must run in a custom dev client, EAS build, or a local native build on a real iOS or Android device.

## Current Build Posture

- SIP/PSTN calling uses `react-native-pjsip`.
- Meetings and group video stay on the future LiveKit/WebRTC path.
- React Native new architecture is disabled until PJSIP and native call modules are proven compatible.
- iOS declares microphone access and background modes for audio, VoIP push, and remote notifications.
- Android declares notification, microphone, and phone-state permissions.

## First Native Build Checklist

1. Install dependencies with the package manager from `packageManager`.
2. Regenerate native projects with `pnpm prebuild:ios` and `pnpm prebuild:android`.
3. Build on real iOS and Android devices, not simulators, for call UI and audio routing.
4. Enter a Phone11 SIP account in Settings.
5. Confirm SIP registration over TLS.
6. Place extension-to-extension, outbound PSTN, inbound DID, and failed-call tests.
7. Capture call id, SIP response code, RTPEngine result, and audio direction for every failed call.

## Native Calling Dependencies

`lib/sip/native-call.ts` is already written to use `react-native-callkeep` when it is installed. Add it in the real native build environment and regenerate the lockfile there:

```sh
pnpm add react-native-callkeep@4.3.16
```

If Phone11 keeps managed Expo prebuild rather than committing native `ios/` and `android/` directories, add the matching Expo config plugin in the same environment and regenerate the lockfile:

```sh
pnpm add @config-plugins/react-native-callkeep
```

Do not commit manually edited lockfile package metadata. Let `pnpm` write the resolved package metadata from npm.

## Acceptance Gate

The first mobile build slice is complete only after:

- SIP registration works on at least one real iPhone and one real Android device.
- Outbound call connects with two-way audio.
- Inbound call shows native incoming UI when app is foregrounded.
- Mute, hold, speaker, keypad DTMF, and hangup update both UI state and SIP state.
- Every failure has a correlated app log, SIP log, and RTPEngine log.
