# Phone11 Native Mobile Build

Phone11 Cloud Phone cannot be tested in Expo Go. The mobile app uses native SIP and native calling modules, so every serious call test must run in a custom dev client, EAS build, or a local native build on a real iOS or Android device.

## Current Build Posture

- SIP/PSTN calling uses `react-native-pjsip`.
- Meetings and group video stay on the future LiveKit/WebRTC path.
- React Native new architecture is disabled until PJSIP and native call modules are proven compatible.
- iOS declares microphone access and background modes for audio, VoIP push, and remote notifications.
- Android declares notification, microphone, and phone-state permissions.

## First Native Build Checklist

1. Run `pnpm setup:dev-client` in a network-enabled build environment.
2. Run `npx eas-cli@latest login` and `npx eas-cli@latest init`.
3. Build installable dev clients with `pnpm eas:dev:android` and `pnpm eas:dev:ios`.
4. Start Metro with `pnpm dev:client`.
5. Build on real iOS and Android devices, not simulators, for call UI and audio routing.
6. Enter a Phone11 SIP account in Settings.
7. Confirm SIP registration over TLS.
8. Place extension-to-extension, outbound PSTN, inbound DID, and failed-call tests.
9. Capture call id, SIP response code, RTPEngine result, and audio direction for every failed call.

## Native Calling Dependencies

`lib/sip/native-call.ts` is already written to use `react-native-callkeep` when it is installed. The setup script installs the native dev-client dependencies and regenerates the lockfile:

```sh
pnpm setup:dev-client
```

Do not commit manually edited lockfile package metadata. Let `pnpm` write the resolved package metadata from npm.

See `docs/EAS_DEV_CLIENT_SETUP.md` for the full EAS build flow.

## Acceptance Gate

The first mobile build slice is complete only after:

- SIP registration works on at least one real iPhone and one real Android device.
- Outbound call connects with two-way audio.
- Inbound call shows native incoming UI when app is foregrounded.
- Mute, hold, speaker, keypad DTMF, and hangup update both UI state and SIP state.
- Every failure has a correlated app log, SIP log, and RTPEngine log.
