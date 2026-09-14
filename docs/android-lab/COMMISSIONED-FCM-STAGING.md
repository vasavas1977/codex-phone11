# Commissioned Android FCM staging build

The commissioned build is an isolated staging path. It does not create a Firebase project, upload configuration, send a push, deploy a server, or enable a production package. The ordinary Android virtual-lab build remains uncommissioned and requires no `google-services.json`.

## Build contract

`pnpm lab:android:build:staging` accepts only an explicit, internally consistent configuration:

| Setting | Required value or rule |
| --- | --- |
| `PHONE11_ANDROID_WAKE_COMMISSIONED` | `1` |
| `PHONE11_ANDROID_FIREBASE_COMMISSIONED` | `1`; must agree with the wake flag |
| `PHONE11_ANDROID_WAKE_ENVIRONMENT` | `staging` |
| `PHONE11_ANDROID_LAB_PACKAGE` | Exactly `ai.phone11.mobile.staging` |
| `PHONE11_ANDROID_FIREBASE_PROJECT_ID` | Firebase project ID containing a `staging`, `stage`, `sandbox`, or `nonprod` segment |
| `PHONE11_ANDROID_FIREBASE_SENDER_ID` | Non-placeholder numeric Firebase project number |
| `PHONE11_ANDROID_FIREBASE_APP_ID` | Android Firebase app ID whose sender component matches the declared sender ID |
| `PHONE11_ANDROID_GOOGLE_SERVICES_FILE` | Path to a private `google-services.json` for the exact staging package |
| `EXPO_PUBLIC_API_BASE_URL` | HTTPS origin whose host contains a staging marker |
| `PHONE11_ANDROID_SIP_HOST` | SIP host whose name contains a staging marker |

The validator reads the Firebase file at build time and checks its project ID, project number, mobile SDK app ID, and sole Android client package. A missing or malformed file, a mismatched field, a placeholder, an ordinary lab or production package, a production-looking endpoint, HTTP, or one enabled commission flag fails before Expo receives the configuration. The path is passed to Expo as `android.googleServicesFile` only after those checks pass.

Keep the real Firebase file and values in the approved private build environment. Do not commit them, place them in `.env`, print them in logs, or copy them into this document. Once the environment has injected every value above, run:

```sh
pnpm lab:setup
pnpm lab:android:build:staging
```

The command starts from the same scrubbed environment as the ordinary lab build, restores only the explicitly supplied staging variables listed above, and validates them before Expo prebuild can consume the Firebase file. It verifies the final APK package, retains the APK and a credential-free identity record under private `.lab/` paths, and does not send FCM traffic. `pnpm lab:test:push:live` remains blocked until the isolated provider and a test device are deliberately commissioned and delivery evidence is captured.

The read-only [Firebase staging inventory](FIREBASE-STAGING-INVENTORY-2026-09-14.md) found no current project/file pair that meets this contract. Do not reuse the nearby production or legacy candidates to make the gate pass.

## Uncommissioned path

`pnpm lab:android:build` forces the existing virtual-lab identity `ai.phone11.mobile.lab`, loopback API/SIP settings, and both commission gates to zero by omission. It deliberately supplies no Firebase file. Supplying Firebase identity fields while the gates are off is rejected so a credential cannot silently enter an ordinary lab build.
