# Team Chat inbox web candidate — 25 September 2026

This note records a prepared static web artifact for the Team Chat inbox update. It does not record a deployment or live-site check.

## Exact source and export

The client source is commit `8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1`. Its clean `git archive` is at `/tmp/phone11-inbox-web-source-8b567c7`; all 1,883 tracked blobs matched the commit before export. The copied dependency tree came from `/tmp/phone11-direct-prejoin-web-source-47d48a6/node_modules`; `package.json` and `pnpm-lock.yaml` matched the dependency source.

The web export used:

```sh
EXPO_PUBLIC_API_BASE_URL=https://api.phone11.ai EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform web
```

Expo completed 70 static routes. The sealed artifact is `/tmp/phone11-inbox-web-releases/8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1`. Its manifest covers 121 regular files, including the release marker, with no symlinks or unlisted files.

- Export manifest SHA-256: `4003ee267e152b5b977b8779f4754df1f047cb667ce2460a8478775b30be3511`
- Release marker SHA-256: `7be682f3f97d28808ea7d8e458b89a19d8d973597d06686717434140838ee7c3`
- Browser entry: `_expo/static/js/web/entry-871141f21bd5b03c167420d44523226e.js`
- Browser entry SHA-256: `9c5cc377551f7b420e1376498d4832d3da59b53f3a0c36bfbd6e744310d8f5f4`
- Transfer archive: `/tmp/phone11-inbox-web-8b567c7.tar.gz`
- Transfer archive SHA-256: `b46016b5d8864c5fbe7c95c81dcd67d70e38370c50d5f24f7323f1ebc731cfe1`

The archive was created with `COPYFILE_DISABLE=1`; it contains the 121 sealed release files plus `export-manifest.json`, with no AppleDouble or `.DS_Store` entries. Every sealed release file in the archive matched its manifest hash.

## Guarded operator pins

Use `scripts/phone11-chat-inbox-static-rollout.py` with the unchanged `scripts/phone11-static-portal-rollout.py` controller. The wrapper pins the controller SHA-256 to `b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5`, the candidate source/export/marker/browser entry above, and predecessor `47d48a697921fc20f7b638f6b00447072b9fe7b7`.

The wrapper tests, historical controller regression suite, wrapper pin checks, Python compilation, and full local controller validation of the candidate artifact passed. Deployment preparation and activation were not run. No edge host, live symlink, Nginx configuration, API service, or database was touched. Public marker, asset, browser interaction, account sign-in, and native handset behavior remain unverified for this candidate.
