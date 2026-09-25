# Meeting-title web release handoff — 25 September 2026

This release makes an admitted channel meeting show its tenant-scoped title in
the web/mobile prejoin picker. Admission and Join still use the opaque meeting
ID. Generic invitation links keep the IDs-only listing. The API title route is
already live separately; this document covers only the static web frontend.

## Immutable candidate

- Committed application source: `5e7bf01152ddab01a6a043c464e0f4749c71c55d`.
- Clean source archive: `/tmp/phone11-title-web-source-5e7bf01` (created with
  `git archive` from that commit). A frozen pnpm 9.12.0 install with scripts
  disabled supplied local dependencies; no application source file changed.
- Export command: `EXPO_PUBLIC_API_BASE_URL=https://api.phone11.ai
  EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform web`.
  The first attempt hit the known generated NativeWind `web.css` SHA-1 race;
  the retry succeeded from unchanged source. The result has 70 static routes.
- Sealed release directory:
  `/tmp/phone11-meeting-title-web-releases/5e7bf01152ddab01a6a043c464e0f4749c71c55d`.
  The `export-manifest.json` hashes all 121 regular files, including the
  release marker, with no symlinks or extra files.
- Export manifest SHA-256:
  `c9ca6aacfb32343c23e7bf89c9f430fc1f92ce749b325e1009612bf0ac0f35e1`.
- Release marker SHA-256:
  `02e43eadf4bd4394bb1c6b8cf4c2222b67eb57a76a2f2e4b26f378aa8f5d7ea1`.
- Browser entry:
  `_expo/static/js/web/entry-b107dfa349eee9d86f165ad57f4c3ee1.js`,
  SHA-256 `ae5d08c851db4ea5ce371fbb41024a21830082a716bf911b67c7466aecc69c46`.
- Transfer archive: `/tmp/phone11-meeting-title-web-5e7bf01.tar.gz`, SHA-256
  `6e9b9bc091b233a30000eac6295de351f12709a7a9fec216fded104453bd35f1`.
  It was made with `COPYFILE_DISABLE=1`; listing showed no AppleDouble or
  `.DS_Store` entries.

## Guarded operator

Use `scripts/phone11-meeting-title-static-rollout.py` for this release and
stage its companion `scripts/phone11-static-portal-rollout.py` in the same
root-owned operator directory. The wrapper pins the companion's SHA-256 to
`b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5`.
It pins this candidate's source, export manifest, marker, entry file, and the
observed live predecessor `0d13ddcba981c6a1dd04fae44dd1f11608f296ca`.
It checks the predecessor during both managed prepare and rollback. The
companion retains its complete export-tree validation, exact Nginx checks,
root-only receipt, and automatic rollback on failed activation.

The existing `scripts/phone11-static-portal-rollout.py` retains its prior
candidate pins and is not the entry point for this update. Its historical
rollback receipt remains available.

## Host operation gates

The edge-host manifest must be freshly built from the live TLS site, effective
Nginx dump, enabled-site symlink, and the two historical include paths. Its
`release.source_sha` and `release.manifest_sha256` must match this handoff, and
`release.directory` must be
`/var/www/phone11-portal/releases/5e7bf01152ddab01a6a043c464e0f4749c71c55d`.
Keep `release.current_link` and `state_dir` at their existing managed paths.
Do not reuse an old Nginx-dump pin if the host has changed.

Before `--prepare`, verify the transferred archive hash, extract only into the
inactive release directory, and make each serving directory root-owned and
world-readable/searchable (`0555`) and every regular file root-owned and
world-readable (`0444`). The protected controller rejects writable or
unreadable serving trees and any unsealed file. Then run `--prepare`,
`--activate --dry-run`, and guarded `--activate` with the new wrapper and exact
manifest. Preserve the generated receipt. Confirm the public release marker,
browser entry hash, `/portal` and `/conference`, and a signed-in channel
prejoin title. Roll back with the same wrapper and manifest if any live probe
or channel-title check fails.

Local validation completed: the wrapper's five focused tests, the companion's
22 regression tests, Python compilation, and full pinned export-tree validation
passed. Independent source review found no P0–P2.

The candidate was staged on the Phone11 web edge with root-owned serving files
and a root-only manifest. Guarded `--prepare`, `--activate --dry-run`, and
`--activate` passed. The active link now resolves to
`/var/www/phone11-portal/releases/5e7bf01152ddab01a6a043c464e0f4749c71c55d`.
The root-only activation receipt is
`/etc/nginx/phone11-static-portal-rollout/5e7bf01152ddab01a6a043c464e0f4749c71c55d/receipt.json`,
SHA-256 `b932fd73f881f031c7abc881d84ccbcb08042a03b11dbe2a4954eea8c10d8a8d`.
The Nginx site SHA-256 remains
`e3ca95837a5017913a079059f1cfdc13820c236d09bb8d3a4f35ecc434a4020f`.
Public marker and browser-entry hashes match their sealed pins, and `/portal`,
`/conference`, and `/teamchat` each returned HTTP 200. In a signed-in Test
channel, a new meeting appeared as **Test** in prejoin, joined with microphone
and camera off, showed **Connected**, and left cleanly. This verifies title
display and one-person browser lifecycle; it does not verify two-device media,
iPhone behavior, or desktop runtime.
