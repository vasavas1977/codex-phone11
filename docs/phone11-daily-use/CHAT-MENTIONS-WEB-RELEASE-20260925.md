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

## Guarded operator pins

Use `scripts/phone11-chat-mentions-static-rollout.py` with the unchanged `scripts/phone11-static-portal-rollout.py`. The wrapper pins the controller SHA-256 to `b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5`, candidate source, export manifest, archive, marker, browser entry, and observed static predecessor `8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1`. It enforces that predecessor for both managed preparation and rollback.

The historical inbox wrapper and generic controller retain their existing candidate pins. No host, live symlink, Nginx configuration, API service, or database was touched. Deployment, public asset/marker checks, authenticated browser behavior, and handset behavior remain unverified for this candidate.

## Offline validation

The candidate export tree was validated with the pinned controller. The release-specific wrapper tests, historical static-controller regression suite, Python compilation, marker/entry/archive hashes, and archive member checks passed. This demonstrates local artifact integrity only, not activation or public delivery.
