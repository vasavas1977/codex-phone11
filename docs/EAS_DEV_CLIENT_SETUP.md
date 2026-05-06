# Phone11 EAS Development Client Setup

Phone11 needs a custom development client because the real cloud-phone path uses native SIP, native call UI, and native audio behavior. Expo Go cannot load those modules.

## What Is Already Configured

- `eas.json` has development, iOS simulator, preview, and production profiles.
- `package.json` has scripts for setup, dev-client Metro, and EAS development builds.
- Native app config already declares microphone permissions, iOS VoIP/audio background modes, and Android call/audio permissions.
- GitHub Actions has a manual Android development-client workflow at `.github/workflows/phone11-eas-android-dev-client.yml`.

## One-Time Setup

Run these from the repo root in a network-enabled environment:

```sh
pnpm setup:dev-client
npx eas-cli@latest login
npx eas-cli@latest init
```

The setup script installs:

- `expo-dev-client`
- `react-native-callkeep`
- `@config-plugins/react-native-callkeep`

It intentionally lets `pnpm` update `package.json` and `pnpm-lock.yaml`. Do not hand-edit the lockfile.

## Build Dev Clients Locally

Android installable APK:

```sh
pnpm eas:dev:android
```

iPhone device build:

```sh
pnpm eas:dev:ios
```

iOS simulator build:

```sh
pnpm eas:dev:ios-sim
```

An iPhone device build requires a paid Apple Developer account so EAS can create signing credentials.

## Build Android Dev Client From GitHub Actions

Use this path after the Expo project has been initialized and the repository has an Expo access token.

1. Create an Expo access token from the Expo account that owns the Phone11 project.
2. In GitHub, open the repository settings.
3. Go to Secrets and variables > Actions.
4. Add a repository secret named `EXPO_TOKEN`.
5. Open Actions > Phone11 EAS Android Dev Client.
6. Click Run workflow.
7. Keep `eas_profile` as `development`.
8. Leave `wait_for_build` off to queue the build quickly, or turn it on if GitHub Actions should wait for the APK result.

If the workflow fails because the Expo project is not linked yet, run `npx eas-cli@latest init` once from a logged-in machine, commit the resulting project ID change, and run the workflow again.

## Run The App After Installing The Dev Client

After the dev client is installed on the phone:

```sh
pnpm dev:client
```

Open the Phone11 dev client on the device and connect to the Metro URL. For first SIP testing, keep the phone and development machine on the same network or use a tunnel if LAN discovery is unreliable.

## First Call Test

1. Open Phone11 Settings.
2. Add the SIP account.
3. Confirm registration state changes to registered.
4. Open Settings > SIP Diagnostics.
5. Place an extension call and a PSTN call.
6. Capture the diagnostics event trail together with Kamailio and RTPEngine logs.

The first development-client build is successful only when real-device registration and outbound audio are confirmed.
