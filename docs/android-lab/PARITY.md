# Shared iOS / Android delivery

Both apps use the same `app/`, `components/`, `constants/`, `hooks/`, and `lib/` source. Build this branch for each platform to receive the shared screens, colors, contact behavior, call history, recording details, speaker-labeled transcripts, and future shared changes. A build is not runtime acceptance.

| Feature | Shared source | iOS evidence | Android evidence / gap |
|---|---|---|---|
| Phone / Recents / Contacts / Team | Expo Router screens and shared theme | Existing Build39 task reports installed | Same sources bundled; emulator rendering and authenticated UCC acceptance tracked separately |
| Recording / transcript / AI summary | Shared recording client and backend | Latest recording ready; AI failed three attempts. Safe diagnostic categorization and shared playback fixes prepared; not deployed or installed | Shared seek/playback fixes bundled; local SIP fixture does not implement authenticated cloud recording backend |
| Recording seek and speaker | Shared draggable and accessible seek control; native route capability | Speaker choice and audio-session ownership fixes pass local tests; signed distribution profile/APNs unavailable locally, handset listening still open | Draggable seek source bundled; explicit playback speaker/earpiece selector requires an Android native adapter |
| Siprix voice controls | Shared TypeScript engine contract | Existing Objective-C bridge plus reviewed recording-route addition | Real pinned Android 1.1.0 runtime loaded; first synthetic call/control samples succeeded, final repeatability report is authoritative |
| Background call / native wake | Shared ownership contract, native adapters | Existing iOS implementation | Android FCM receiver and native service pending; explicitly unsupported |
| Audio and accessories | Shared controls; platform routing | Requires fresh iPhone check for recording playback | Emulator does not validate physical earpiece, Bluetooth or acoustics |

Future product changes must use shared implementation where possible and include both platform checks. Native APIs are not interchangeable; parity gaps require implementation and acceptance, not automatic code translation. Other applications should adopt the same approach when their repositories are in scope; this change does not modify unrelated apps.

The added pull-request workflow runs shared calling, recording/playback, authenticated wake-contract, lab isolation, media-detector, and native guard tests without live credentials. It does not build, distribute, or automatically approve native platform changes. Installed apps receive changes only after a new build is distributed.
