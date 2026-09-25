# Direct-meeting prejoin release — 25 September 2026

The committed client at `47d48a697921fc20f7b638f6b00447072b9fe7b7`
shows the safe admitted meeting title when a deep link selects that exact
meeting. Join continues to use its opaque meeting ID. The web candidate below
was subsequently activated and independently checked on the live site.

## Sealed local artifact

- Source: `git archive` of the exact commit above at
  `/tmp/phone11-direct-prejoin-web-source-47d48a6`. All 1,880 tracked blobs
  still matched the commit after export. `package.json` and `pnpm-lock.yaml`
  match the installed dependency source used for the preceding release.
- Export: `EXPO_PUBLIC_API_BASE_URL=https://api.phone11.ai
  EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform web`.
  It produced 70 static routes. A symlinked dependency-tree attempt failed
  before bundling; copying the same installed tree into this isolated source
  made the export succeed.
- Sealed directory:
  `/tmp/phone11-direct-prejoin-web-releases/47d48a697921fc20f7b638f6b00447072b9fe7b7`.
  Its `export-manifest.json` covers exactly 121 regular files, with no symlinks
  or unlisted files. Export manifest SHA-256:
  `b1c46c144c6f07bc085862bd1ed2ad09bc7fb8d2c4a808d5956e8728fc297cc9`.
- Release marker SHA-256:
  `c33829a0eb0a416b29822a7e1425ed4b84a33f3c4607f07e1dabf9bc517a6c4b`.
- Browser entry:
  `_expo/static/js/web/entry-288999297a1bf806e0b3125b17615d7d.js`,
  SHA-256 `8628f13476eab8a58fab496edc79f054d9046c59256469a7eba0a0cb3a90a27d`.
- Transfer archive: `/tmp/phone11-direct-prejoin-web-47d48a6.tar.gz`,
  SHA-256 `bf5a99362872b6dc0f439d1da5d71b75fbf3e905ef8e30a5f4344e8d95ba8703`.
  It contains one commit-named directory, 121 sealed files, and no AppleDouble
  or `.DS_Store` entries. Every archived file hash matched the manifest.

## Guarded host handoff

Use `scripts/phone11-direct-prejoin-static-rollout.py` with its companion
`scripts/phone11-static-portal-rollout.py` in one root-owned operator directory.
The wrapper pins the companion SHA-256 to
`b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5`,
the exact candidate export, and the observed live predecessor
`5e7bf01152ddab01a6a043c464e0f4749c71c55d`. It validates the predecessor
on managed prepare and rollback. Preserve that predecessor's release directory
and receipt.

Build a fresh, root-only host manifest at
`/root/phone11-static-portal-47d48a6.json`. Its `release.directory` must be
`/var/www/phone11-portal/releases/47d48a697921fc20f7b638f6b00447072b9fe7b7`,
`release.manifest` the `export-manifest.json` inside that directory,
`release.source_sha` the full candidate SHA, and `release.manifest_sha256` the
hash above. Preserve the existing managed `current_link` and `state_dir` paths.
Capture the current TLS site, effective Nginx dump, enabled-site link, and both
legacy include hashes from the host immediately before preparing. The previous
manifest is not a fresh host pin. The controller rejects drift.

After independently checking the transferred archive hash, extract only the
commit-named directory into the inactive release path. Set serving directories
root-owned `0555` and regular files root-owned `0444`; confirm the Nginx worker
can read them. Install both operator files root-owned and unwritable by other
accounts at `/opt/phone11ai/portal-operator/47d48a697921fc20f7b638f6b00447072b9fe7b7/`.
With that staged state and the fresh host manifest, run these guarded commands
in order:

```sh
sudo python3 /opt/phone11ai/portal-operator/47d48a697921fc20f7b638f6b00447072b9fe7b7/phone11-direct-prejoin-static-rollout.py --prepare --manifest /root/phone11-static-portal-47d48a6.json
sudo python3 /opt/phone11ai/portal-operator/47d48a697921fc20f7b638f6b00447072b9fe7b7/phone11-direct-prejoin-static-rollout.py --activate --dry-run --manifest /root/phone11-static-portal-47d48a6.json
sudo python3 /opt/phone11ai/portal-operator/47d48a697921fc20f7b638f6b00447072b9fe7b7/phone11-direct-prejoin-static-rollout.py --activate --manifest /root/phone11-static-portal-47d48a6.json
```

Keep the new root-only receipt. Verify the public marker and browser-entry
hashes, `/portal` and `/conference`, and a signed-in direct-meeting prejoin
title. If the live behavior fails, use the same sealed operator and manifest:

```sh
sudo python3 /opt/phone11ai/portal-operator/47d48a697921fc20f7b638f6b00447072b9fe7b7/phone11-direct-prejoin-static-rollout.py --rollback --manifest /root/phone11-static-portal-47d48a6.json
```

Local checks passed: five wrapper tests, 22 controller regression tests, Python
compilation, the controller's full target-release validation, tracked-source
blob comparison, and archive-to-manifest verification.

## Activation and browser evidence

- The candidate was installed at the commit-named release path above, root
  owned and read-only for serving. The predecessor `5e7bf01152ddab01a6a043c464e0f4749c71c55d`
  and its receipt were retained for guarded rollback.
- The fresh, root-only host manifest was
  `/root/phone11-static-portal-47d48a6.json`, SHA-256
  `a088329e8bd3833e344c616835491c417109d43ac451c669b4667987deaf25fc`.
  The pre-activation TLS site and effective Nginx configuration hashes were
  `e3ca95837a5017913a079059f1cfdc13820c236d09bb8d3a4f35ecc434a4020f`
  and `9f08b86f87a3ca0268f26b29164fca785ad3c95462e5bd9c733eacc121e79c5d`.
- Guarded prepare, activation dry run, and activation all passed. The current
  symlink points to this release. The new root-only receipt is
  `/etc/nginx/phone11-static-portal-rollout/47d48a697921fc20f7b638f6b00447072b9fe7b7/receipt.json`,
  SHA-256 `5433674e2d4ba9d96ba72f202d7905dded0c67de4060654749bab447e98c527b`.
  The TLS site hash remained unchanged and `nginx -t` passed.
- Public marker and browser-entry hashes matched the sealed artifact.
  `/portal`, `/conference`, and `/teamchat` returned HTTP 200. In a signed-in
  browser, the direct Test channel link with its meeting ID showed `Meeting
  Test`, no other meeting choices, and an enabled Join meeting button after
  session hydration. This proves the web prejoin route, not an actual room
  connection or native handset behavior.

## Signed iOS build

- EAS internal iOS build 99 finished from exact source commit
  `47d48a697921fc20f7b638f6b00447072b9fe7b7`:
  <https://expo.dev/accounts/vasavas/projects/phone11ai/builds/c99719e8-02d9-48b3-8d70-972efa26d1da>.
  The IPA is retained at
  `/Users/vasavas16macbookpro/Library/Application Support/Phone11/verified-builds/99/Phone11-99.ipa`,
  SHA-256 `f39487a9185bf5dd513ad80f9e0336a1b577cd9152c94fed511daabd6b657b95`.
- Focused native tests passed 11/11 and TypeScript `--noEmit` passed before
  build. The signed daily-pilot verifier passed against the retained build 49
  baseline, including deep signature, production APNs, Siprix framework and
  bridge, call-mode and wake/chat markers, disabled OTA, and matching signing
  team and provisioned devices.
- The paired iPhone 17 Pro Max reported build 98 before installation and build
  99 afterward. `codesign --verify --deep --strict` passed on the extracted
  app, and `devicectl` launched its bundle successfully. The 1020 iPhone was
  unavailable to this Mac. No on-device prejoin visual, room join, media, or
  two-device behavior is claimed from this installation and launch alone.
