# Phone11 platform parity

The owner requires Phone11 iOS and Android to share the same look, feel, and supported product features. Treat new app work as a change for both platforms by default.

- Keep screens, design tokens, assets, business logic, API clients, and feature contracts shared in the existing React Native app. Do not duplicate product screens into an Android fork.
- Native changes (calling SDK, audio routes, notifications, background execution, permissions, store packaging) need a platform adapter and tests on each affected platform. An iOS-only fix does not automatically implement Android behavior.
- For every feature, record both platform outcomes and any explicit gap in `docs/android-lab/PARITY.md`. Missing Android support must be visible before describing a feature as complete.
- Shared source changes reach both apps when rebuilt. Build/install/distribution and physical acceptance are separate steps; do not promise immediate updates to already installed apps.
- Preserve iOS production defaults. Android Siprix remains behind `PHONE11_ANDROID_LAB=1` until separately reviewed and approved for release.
- Keep lab accounts, secrets, routing, APK identity, and runtime evidence separate from production. No deployment, store submission, or live trunk calls are authorized by this lab workstream.
