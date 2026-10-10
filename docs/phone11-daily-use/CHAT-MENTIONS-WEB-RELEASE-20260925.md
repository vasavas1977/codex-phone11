# Team Chat Mentions web release handoff — 25 September 2026

This package contains the static web client with the Team Chat Mentions filter. It is a prepared candidate only; this note does not record a deployment or live-site check.

## Immutable candidate

- Exact committed client source: `60656db3d5d98f59c6f428371061158c8d54deff`.
- Clean source archive: `/tmp/phone11-chat-mentions-web-source-60656db3d5d98f59c6f428371061158c8d54deff`. All 1,893 tracked blobs matched the commit before export. The dependency tree was copied from the installed Phone11 checkout; the archived `package.json` and `pnpm-lock.yaml` matched it. No application source files were edited for the export.
- Export command: `EXPO_PUBLIC_API_BASE_URL=https://api.phone11.ai EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform web`.
- Expo completed 70 static routes.
- Sealed release directory: `/tmp/phone11-chat-mentions-web-releases/60656db3d5d98f59c6f428371061158c8d54deff`. Its manifest covers 121 regular files including the release marker, with no symlinks or unlisted files.
- Export manifest SHA-256: `a1e0f7f556ab6e634cca2ab8db2ff6cf2b29130438c9196d814a852c53abad4c`.
- Release marker SHA-256: `032fce7c48457da2cd6d2772178c42a78d8d3aaa4d289b8db526ec8f3f0435bd`.
- Browser entry: `_expo/static/js/web/entry-e5806337e7053bd915cc9831df555376.js`.
- Browser entry SHA-256: `c75fa2959a5d1b430f5e750dbe2a131fbd972937cc0358bb1f3a9a0146407a96`.
- Transfer archive: `/tmp/phone11-chat-mentions-web-60656db.tar.gz`.
- Transfer archive SHA-256: `76c9f70743cf6cea20a2a6c984d0007404b82b71c49f0d829af9eaccaeba633b`.

The archive was created with `COPYFILE_DISABLE=1`; its sealed release files match the export manifest and it contains no AppleDouble or `.DS_Store` entries.

## Live web activation

The edge accepted guarded `prepare`, activation dry run, and activation for this exact release. `/var/www/phone11-portal/current` points to `60656db3d5d98f59c6f428371061158c8d54deff`; the retained predecessor is `8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1`. The root-only manifest at `/root/phone11-static-portal-mentions.json` has SHA-256 `434d29a143a7235f8f69094bee50bfeebc8b252700895b1e73e3ebf03e3c45ac`. The managed receipt at `/etc/nginx/phone11-static-portal-rollout/60656db3d5d98f59c6f428371061158c8d54deff/receipt.json` has SHA-256 `feac7a50afe26fa7f1d6ad613b9994ab2f28394be89e466c8367efa9bc0696b1`. Nginx syntax passed; the site and full-dump hashes remained unchanged from the predecessor.

The public release marker reported source `60656db3d5d98f59c6f428371061158c8d54deff`, the public browser entry matched pinned SHA-256 `c75fa2959a5d1b430f5e750dbe2a131fbd972937cc0358bb1f3a9a0146407a96`, and `/teamchat` returned HTTP 200. In an authenticated browser, the Mentions filter appeared between Unread and Chats and opened an empty-result state for the test account. That account had no unread mention at observation time, so a live delivered-mention test is not claimed.

## Guarded operator pins

Use `scripts/phone11-chat-mentions-static-rollout.py` with the unchanged `scripts/phone11-static-portal-rollout.py`. The wrapper pins the controller SHA-256 to `b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5`, candidate source, export manifest, archive, marker, browser entry, and observed static predecessor `8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1`. It enforces that predecessor for both managed preparation and rollback.

The historical inbox wrapper and generic controller retain their existing candidate pins. This web activation changed only the managed static `current` link and its Nginx-served release. API service and database state are recorded separately.

## Offline validation

The candidate export tree was validated with the pinned controller. The release-specific wrapper tests, historical static-controller regression suite, Python compilation, marker/entry/archive hashes, and archive member checks passed. These local checks preceded the separate live activation and public checks above.

## Signed iOS build

The corrected source and release operator commit is `4b1817e6a3b0658059f45cca2fb249c5ee803de0`. [GitHub workflow 36136371182](https://github.com/vasavas1977/codex-phone11/actions/runs/36136371182) passed all seven daily-use jobs, native checks, and the signed build. The full chat PostgreSQL 16 CI suite passed after its stale race-test synchronization was aligned with the current separate assignment and extension locks. [EAS build 101](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/30c33891-1d60-41c9-b769-87bd1f3e23d8) is an internal `preview-ios-siprix-daily-pilot` build from that exact source. Its IPA SHA-256 is `a9b5ba1c7dc317ec5d58b61de8abaa40402f2d8a760fb461d651b64dfafce613`.

The combined Siprix/daily-pilot IPA verifier passed against retained Build 49, including strict signature, production APNs, native bridge, background modes, and disabled OTA updates. Build 101 is retained at `~/Library/Application Support/Phone11/verified-builds/101/Phone11-101.ipa`, with Build 100 and Build 49 available for rollback. `devicectl` installed it in place on the paired iPhone 17 Pro Max `C31981DC-D67D-5AED-8F86-7E826CD4BA0B`; independent inventory reports Phone11 1.0.0 build 101, and a subsequent launch succeeded. No native on-screen Mentions check or two-handset delivery test is claimed. The 1020 handset was unavailable to this Mac.
