# Unsigned offline voicemail bundle — 5 October 2026

This packages the existing producer, relay, fixed runner and both reviewed Lua
helpers without changing their behavior. It performs no installation, image
build, service start, network request, admission, deposit or flag activation.
It does not replace the [release prerequisite](VOICEMAIL-RELEASE-PREREQUISITE-20261005.md)
or the [commissioning/rollback packet](VOICEMAIL-ACCEPTANCE-PACKET-20261004.md).

Use installed `tsx`/`esbuild` dependencies; no dependency installation is needed:

```sh
node_modules/.bin/tsx scripts/phone11-voicemail-bundle.ts \
  --source-root <resolved-absolute-checkout> \
  --output <new-absolute-directory-outside-checkout> \
  --source-revision <exact-40-character-source-SHA>

node_modules/.bin/tsx scripts/phone11-voicemail-bundle-verify.ts \
  --bundle <resolved-absolute-bundle-directory> \
  --runtime-plan <resolved-absolute-private-plan-file> \
  --manifest-sha256 <independently-retained-64-character-manifest-SHA256>
```

The build refuses an existing output directory. It reads stable, single-link,
locally owned source files, refuses symlink inputs and group/other-writable
files, and requires both deploy/infra helper copies to match the existing
reviewed helper hashes. Producer/relay are bundled as Node 22 ESM using the
installed esbuild version. Captured entry bytes are the only compiler source
inputs: an on-resolve gate refuses every dependency except an actual `node:`
built-in supported by the required Node 22 build runtime, and an on-load gate
refuses additional filesystem inputs. The installed TypeScript parser rejects
dynamic `import()`, direct `require()`/`require.resolve()` syntax and non-built-in static
imports/exports before compilation; it does not resolve or read dependencies.
The bundle contains exactly `producer.mjs`, `relay.mjs`, `runner.sh`, both Lua
helpers and canonical `manifest.json`. The manifest records actual input and
artifact hashes, sizes, modes, compiler/parser versions and fixed runtime paths.
No timestamps or output-directory paths enter the manifest. Identical inputs
with the same compiler/parser versions produce identical bytes.
This closes compiler dependency resolution; it is not a sandbox for runtime
filesystem operations in the packaged programs. Tool version labels do not
authenticate the installed compiler/parser or prove build causality.

The source revision is a **caller-supplied label**, not authenticated Git
provenance. Independently review the revision, actual input digests and tool
versions before retaining the printed manifest hash. The verifier checks that
separately supplied hash; copying a changed manifest alongside changed artifacts
does not satisfy the original pin. Neither tool signs the bundle. Local build
completion is not a durable-storage receipt.

The bundle directory and separate runtime-plan directory must be owned by the
invoking local uid with mode 0700. Manifest, plan, `.mjs` and Lua files must be
regular single-link 0600 files; the runner must be 0700. Symlink paths, extra
files, unsafe modes/ownership, missing files, duplicate JSON fields and digest
drift are refused. These modes protect the **offline candidate**; they are not
an instruction to copy files with the developer's uid onto the host.
Checks are bounded file observations, not an atomic lease on the bundle. Retain
the independently reviewed manifest pin and revalidate installed bytes under
the later operator's target/custody boundary before any activation.

The separate plan is JSON with exactly these fields (all values are declarations,
not observations):

- `schema`: `phone11-voicemail-runtime-plan/v1`.
- `runtimeUid`, `runtimeGid`: explicit nonnegative integer process identities;
  `nodeMajor`: 22. Never infer the active runtime identity from this bundle.
- `runtimePaths`: exactly `node=/usr/local/bin/node`, `flock=/usr/bin/flock`,
  `runner=/opt/phone11ai/voicemail/runner.sh`,
  `producer=/opt/phone11ai/voicemail/producer.mjs`,
  `relay=/opt/phone11ai/voicemail/relay.mjs`,
  `legacyHelper=/etc/freeswitch/scripts/phone11_legacy_voicemail.lua`,
  `depositHelper=/etc/freeswitch/scripts/phone11_voicemail_deposit.lua`.
- `sourceRoot`, `outboxRoot`: normalized absolute, distinct non-overlapping
  private data roots; neither may be `/`. This offline plan deliberately
  requires separate roots without altering the existing producer's behavior.
- `mailboxRoots`: nonempty exact `tenantId:extension` → absolute directory map.
  Each mailbox is strictly inside `sourceRoot`; shared/nested mailbox roots
  are refused. These declarations still need trusted target mapping evidence.
- `uploadUrl`: the exact HTTPS `/api/recordings/voicemail` endpoint, without
  userinfo, query or fragment. `integrationSecretEnvironment`: `FS_SHARED_SECRET`.
  No secret value, environment dump or credential file belongs in this plan.
- `backendHookReady`, `freeswitchHookReady`: both false. This verifier cannot
  approve a protected-mode activation plan.
- `filesystemContract`: `ownerUid`/`ownerGid` equal the declared runtime identity,
  `directoryMode=0700`, `fileMode=0600`, and `fileSync`, `directorySync`,
  `exclusiveHardlinks` all true. These are required assumptions, not verified
  mount capabilities or process-readability evidence.

Successful output explicitly reports only offline file checks and a
caller-attested plan. Active-host, durable-storage, secret-provisioning, deposit,
commissioning and rollout results stay false. It never reads the declared data
roots, connects to the declared URL, launches the bundled programs or checks
live Node/flock availability. A later reviewed installation/commissioning plan
must prove those paths, ownership/readability, runtime, mounts, schema, final-WAV
lifecycle, eligible fixtures and rollback compatibility on the exact target.
Preserve the existing route operator's allowlist and default-off flags.
