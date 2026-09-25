# Direct-meeting prejoin web candidate — 25 September 2026

The committed client at `47d48a697921fc20f7b638f6b00447072b9fe7b7`
shows the safe admitted meeting title when a deep link selects that exact
meeting. Join continues to use its opaque meeting ID. This is a prepared static
web candidate; no host upload, Nginx change, or activation has occurred.

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
blob comparison, and archive-to-manifest verification. Host prepare, live
activation, browser behavior, and device behavior remain unrun for this
candidate.
