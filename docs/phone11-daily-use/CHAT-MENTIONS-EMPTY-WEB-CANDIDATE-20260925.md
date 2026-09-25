# Team Chat Mentions empty-state release — 25 September 2026

The live static web client displays **No unread mentions** when the Mentions
filter is selected without unread mentions. The matching signed iOS build is
installed on both paired test iPhones. Native visual verification of this
specific copy remains pending because iPhone Mirroring stopped at the Mac's
protected login prompt after installation.

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

## Live web activation

- A fresh root-only edge manifest was built from the observed TLS site,
  effective Nginx configuration, enabled-site symlink, historical includes,
  and managed predecessor receipt. Manifest SHA-256:
  `89f445b4423b8a3b5a24b7b59e8150a28827410baaf24e1f474c71f4f2d0e79f`.
- The sealed archive and unchanged controller were checked on the edge host.
  The new release was staged root-owned and read-only at
  `/var/www/phone11-portal/releases/3e8686bdb9a6fe07388eb913c3523140aa425412`.
  Guarded `--prepare`, `--activate --dry-run`, and `--activate` passed. The
  prior release remains available for guarded rollback.
- Nginx validation passed; its site configuration and effective configuration
  hashes stayed unchanged. The managed activation receipt is
  `/etc/nginx/phone11-static-portal-rollout/3e8686bdb9a6fe07388eb913c3523140aa425412/receipt.json`,
  SHA-256 `c35280f4d0223e01c10b9c1e2a5ad6a8333155b3bd76085642539c16f1e3bda7`.
- The public release marker at
  `https://1toall.phone11.ai/phone11-static-portal-release.json` reports the
  exact client source `3e8686b`; the public browser entry matched its pinned
  hash and `/teamchat` returned HTTP 200. An authenticated browser check
  selected the Mentions filter and observed **No unread mentions**.

## iOS and test evidence

- Signed iOS Build 102:
  `https://expo.dev/accounts/vasavas/projects/phone11ai/builds/7f2b3ad6-ab66-42c5-b09f-5077d34a96d4`,
  from exact client source `3e8686b`. Its official IPA SHA-256 is
  `86a3b57b4e29532f5fc393c802b73d549384577a4fceed5ee9d0da995af0ff2f`.
  The IPA passed the daily-pilot verifier, including signing, Siprix, and
  production APNs checks. `devicectl` installed it in place on paired iPhone
  17 Pro Max and device inventory reported Phone11 1.0.0 build 102. Its
  embedded provisioning profile also includes the paired iPhone 15 Pro Max
  used by test account 1020. That device was updated in place from Build 96,
  and its device inventory likewise reported Phone11 1.0.0 build 102.
- CI run `https://github.com/vasavas1977/codex-phone11/actions/runs/36141874184`
  passed native-check, build, and all daily-use jobs on source `3e8686b`.
  Locally, 12 focused inbox tests, 85 disposable PostgreSQL chat/notification
  tests, and TypeScript checking passed. Five release-wrapper tests, 22
  unchanged-controller regression tests, Python compilation, source-blob
  comparison, target-release validation, and archive member/hash comparison
  passed.
- On the preceding installed Build 101, the native channel composer displayed
  `@all` and member suggestions when `@` was typed; the unsent draft was
  restored. This is a Build 101 observation only. Build 102's new Mentions
  empty copy has not yet been visually checked on device. No message was sent,
  and no two-handset notification or audio claim follows from these checks.
