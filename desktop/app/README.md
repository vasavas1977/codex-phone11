# Phone11 desktop trial shell

This local Electron shell runs on macOS and Windows and shows the Siprix official trial's 60-second call notice. It uses Phone11's privileged auth provider and Siprix helper supervisor. No packaged launch or live call is claimed here.

From `desktop/app`, run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. Copy `resources/config.example.json` to `resources/config.json` and set the deployed Phone11 HTTPS API origin. The app quits if that file is absent or invalid.

Stage the **complete** platform helper output before generating the integrity manifest:

- macOS: copy the native CMake output `phone11_siprix_helper.app` as `resources/helper/mac/phone11_siprix_helper.app`. Keep `Contents/MacOS/phone11_siprix_helper` and the embedded `Contents/Frameworks/siprix.framework` and `siprixMedia.framework` with their internal symlinks and files. The helper's loader path resolves the frameworks from `@executable_path/../Frameworks`.
- Windows: copy `phone11_siprix_helper.exe`, `siprix.dll`, and `siprixMedia.dll` together into `resources/helper/win/`. The two DLLs must remain beside the executable.

On that platform, run `npm run manifest:helper` and then `npm run build`. The manifest inventories and hashes every regular file and symlink in the staged helper tree. The build pins the manifest's SHA-256 inside the main bundle; launch verifies the manifest, full tree, dependency files, canonical helper path, and symlink containment before provisioning or spawning. A missing manifest causes a build that fails closed for calling. Any change to a helper file requires regenerating the manifest and rebuilding. Run `npm start` for a local trial.

For a local staging rehearsal outside the repository, set `PHONE11_RESOURCE_STAGE` to an absolute directory containing the same `helper/` tree and `config.json` while running `npm run manifest:helper`, `npm run build`, and `npm start`. This variable selects only local build/dev resources; packaged apps always use their own Electron resources directory. It must never contain credentials.

For a distributable package, place `config.json`, `helper-integrity.json`, and the entire `helper/` tree under `<Electron resources>/phone11/`, preserving the paths above. Sign the app and its native helper/dependencies as a unit. Windows code signing and macOS signing/notarization remain release work; this package does not produce a signed installer. The build-pinned hash establishes consistency with the built app, while publisher authenticity depends on signing.

The renderer loads local files with a restrictive CSP, sandbox, and context isolation. Main owns bearer and SIP credentials in memory. The renderer receives only public session/call data and fixed errors. Navigation, new windows, permissions, and webviews are blocked. IPC accepts only allowlisted methods from the one top-level local frame. Call responses and pushed snapshots carry session revision and helper generation so old-account updates are discarded.
