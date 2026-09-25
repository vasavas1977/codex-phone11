# Team Chat inbox release — 25 September 2026

The Team Chat list now uses a camera icon for Meet, keeps loaded rows visible during background refresh, distinguishes draft labels from draft text, and displays the latest sender and attachment-only message previews. A red unread count and blue `@` marker are driven by authoritative unread and mention data when those states exist. The signed-in live browser showed `You: Voice message` for the Test channel after activation, replacing its prior `No messages yet` preview.

## Exact source and validation

- iOS/web client source: `8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1`. The focused React suite passed 65 tests, TypeScript passed, and focused ESLint had no errors (one pre-existing dependency warning in `teamchat.tsx`).
- API candidate source: `2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c`, an isolated copy of deployed `d67be349fbedbda0d4d441c3e0d958ae1481611a` with only the reviewed chat-list metadata deltas. Bundle SHA-256: `75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b`. TypeScript and esbuild passed. Five focused PostgreSQL 17 integration cases passed on a disposable local cluster, including mention read/deletion behavior and attached voice previews; the full PostgreSQL file did not complete because shared fixtures contend under concurrent execution. A 50,000-message local fixture used the unread sequence index. This is not a hosted-database test.
- Independent source/operator review of the API, image, route, and static wrappers found no P0–P2 blockers. Offline operator checks passed: 9 image, 11 route/start, 5 static wrapper, and 22 original static-controller tests.

## iPhone

Signed EAS internal build 100, ID `00a03b98-b1f4-4e39-94dd-fe2ae5bdb09b`, was made from the exact client source with Siprix, production APNs, and background-calling capabilities retained. Its IPA SHA-256 is `fb79b07d743078fd227d46b2df823417a4028b0c32b83bba4180465f503a4e95`. The project IPA verifier passed against the retained build 49 baseline, including deep strict signing. The verified IPA is retained at `~/Library/Application Support/Phone11/verified-builds/100/Phone11-100.ipa`; build 99 and build 49 rollback copies remain. Build 100 was installed, inventoried, and launched on paired iPhone 17 Pro Max `C31981DC-D67D-5AED-8F86-7E826CD4BA0B` (3001). The 1020 handset was unavailable. iPhone Mirroring was locked, so the native on-screen layout was not observed and is not claimed as device UI acceptance.

## Web

The sealed static export from client source `8b567c7` had 121 release files. Manifest SHA-256 `4003ee267e152b5b977b8779f4754df1f047cb667ce2460a8478775b30be3511`, marker SHA-256 `7be682f3f97d28808ea7d8e458b89a19d8d973597d06686717434140838ee7c3`, and browser entry SHA-256 `9c5cc377551f7b420e1376498d4832d3da59b53f3a0c36bfbd6e744310d8f5f4` were validated before upload. The transferred archive SHA-256 was `b46016b5d8864c5fbe7c95c81dcd67d70e38370c50d5f24f7323f1ebc731cfe1`.

The fresh root-only edge manifest `/root/phone11-static-portal-8b567c7.json` had SHA-256 `f8a28db8e672eca29f22fbfc49c68ff1cbd893e1c09d56a6da1b223e8780b64b`. Guarded prepare, activation dry run, and activation passed. `/var/www/phone11-portal/current` points to release `8b567c7`; the retained predecessor is `47d48a6`. The receipt is `/etc/nginx/phone11-static-portal-rollout/8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1/receipt.json`, SHA-256 `c284af216f5a7d3b20bc728dbdf8db333c71814ab19cab322c72f65d7ebb26a1`. `nginx -t` passed. Public marker and browser entry matched their pins and `/teamchat` returned HTTP 200.

## API

The VoIP host built and audited a one-file image overlay from exact 3009 predecessor image `sha256:c66d4e95e4177a75bb4a3c0c6a900de80c57f071b0b3d8d7daa45332404b2398`. New candidate image: `sha256:55b593f0c392c67bc74589dcae4cb0e36b2f2e6dcd8a3552be781429ed0e2d77`. Candidate `cp11-api-candidate-chat-inbox` started healthy on loopback 3010, while 3009 remained healthy. A read-only hosted schema probe found message, attachment, and individual-mention tables; the optional `@all` table is absent and the API handles that condition. Anonymous 3010 and public chat-list calls returned HTTP 401.

The sealed route receipt is `/var/lib/phone11-chat-inbox-release-route/20260925T114421Z-7c93eada47030b31/receipt.json`, active SHA-256 `f2a610c72a033b750e030b0ab2621ac52749ef64f626c41e5d41dfa32a370595`. Inspection showed exactly two changes: `/api/trpc` and `/api/trpc/` proxy targets moved from 3009 to 3010. Guarded activation passed. Current Nginx site SHA-256 is `1b9b4c7d89d2c65c6bf8b730decd57513c46194fe21b5470981c7525d0b0ed26`; both containers are healthy and `nginx -t` passed. The retained 3009 service and sealed receipt support the guarded `rollback --receipt-dir` command in `phone11-chat-inbox-release-route.py`.

In a signed-in browser after the switch, `/teamchat` loaded three conversations, the Test channel showed `You: Voice message`, and the camera icon opened `/conference`. No unread mention existed in that account at observation time; the blue marker is covered by source and local PostgreSQL tests, not a live mention delivery test. Neither a two-phone media test nor a 1020 app update was performed in this release.
