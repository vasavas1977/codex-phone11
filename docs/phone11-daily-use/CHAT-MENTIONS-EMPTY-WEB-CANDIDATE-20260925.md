# Team Chat Mentions empty-state web candidate — 25 September 2026

This prepared static web client displays **No unread mentions** when the
Mentions filter is selected without unread mentions. It is a local candidate;
this note records no staging, activation, public browser check, or device test.

## Sealed candidate

- Exact committed source: `3e8686bdb9a6fe07388eb913c3523140aa425412`
  on `codex/phone11-voice-conference-release-20260920`.
- Clean `git archive` source:
  `/tmp/phone11-chat-mentions-empty-web-source-3e8686bdb9a6fe07388eb913c3523140aa425412`.
  All 1,899 tracked blobs matched the commit. The installed dependency tree was
  copied from the previous clean Mentions export; `package.json` and
  `pnpm-lock.yaml` are identical at both source commits. No application source
  was edited for this export.
- Export command: `EXPO_PUBLIC_API_BASE_URL=https://api.phone11.ai
  EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform web`.
  Expo completed 70 static routes.
- Sealed directory:
  `/tmp/phone11-chat-mentions-empty-web-releases/3e8686bdb9a6fe07388eb913c3523140aa425412`.
  `export-manifest.json` covers 121 regular files, including the release marker;
  the tree has no symlinks or unlisted files. Manifest SHA-256:
  `e6545cbf2c5171cdd445148eb3cf14e3243677c229c745dd7a66de5f253b3f8a`.
- Release marker SHA-256:
  `a589d4c6d9bd437fe3fd0185fab98b527bc519b83c90da3c072728ba878c2002`.
- Browser entry:
  `_expo/static/js/web/entry-0ca51714385d972ca75b417c992b83d1.js`,
  SHA-256 `240f85de77ce3be3b9677a1f755a914ea7bd3524d38712b8e33afdf6ca7e555e`.
- Transfer archive: `/tmp/phone11-chat-mentions-empty-web-3e8686b.tar.gz`,
  SHA-256 `865258470b093f62f8d5c0d411bad81571fdcb9b6af6f920ae4e7610054713cd`.
  It was created with `COPYFILE_DISABLE=1`, contains one commit-named directory,
  and has no AppleDouble or `.DS_Store` entries. Every archived file matched
  its sealed local counterpart.

The unchanged static controller's full `validate_target_release` check passed
against this directory. It checks the complete file set and hashes, exact
marker, browser entry, and baked `https://api.phone11.ai` origin. The new
entry point is `scripts/phone11-chat-mentions-empty-static-rollout.py`; it pins
the unchanged controller SHA-256
`b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5`,
all candidate hashes above, and live predecessor source
`60656db3d5d98f59c6f428371061158c8d54deff` for both managed preparation
and rollback. The earlier Mentions wrapper remains unchanged.

## Host handoff, pending deployment

Build a fresh root-only edge manifest from the current TLS site, effective
Nginx dump, enabled-site symlink, both historical includes, and the managed
receipt. Its `release.directory` must be
`/var/www/phone11-portal/releases/3e8686bdb9a6fe07388eb913c3523140aa425412`,
`release.manifest` the `export-manifest.json` inside that directory,
`release.source_sha` the full candidate SHA, and
`release.manifest_sha256` the hash above. Keep the managed `current_link` and
`state_dir` paths. Do not reuse a previous host manifest or assume that the
observed predecessor is still live; the wrapper must reject a changed one.

After checking the transfer archive hash, stage only the inactive candidate.
Make serving directories root-owned `0555` and files root-owned `0444`. Put the
new wrapper and unchanged controller together in a protected operator
directory. Run guarded `--prepare`, `--activate --dry-run`, and `--activate`
with the fresh manifest; retain the receipt and predecessor release for guarded
rollback. Verify the public marker and entry hashes, `/teamchat`, and the
authenticated Mentions empty state after activation.

Local checks: five release-wrapper tests, 22 unchanged-controller regression
tests, Python compilation, full target-release validation, tracked-source blob
comparison, and archive member/hash comparison passed. These checks do not
establish a live deployment or native handset behavior.
