# Fixed iOS daily-pilot request and private-output boundary

This source prepares one standalone INTERNAL daily-pilot build using existing
remote ad-hoc credentials. It performs no submission, credential inspection,
Apple login, device registration, signing, download or installation during
preparation. Independent source review and exact published-source readback are
required before the lead submits a request. Siprix remains the 60-second trial.

The former workflow redirected only EAS stdout, printed a provider artifact URL,
and uploaded the raw build result. Expo 23.2.0
[JSON mode](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/utils/json.ts)
routes ordinary logs to stderr; remote iOS setup calls
[displayProjectCredentials](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/credentials/ios/actions/SetUpBuildCredentials.ts),
which prints certificate/team/provisioning/device identifiers. The new parent
captures both child streams without relaying them or writing private files.
It keeps at most 256 KiB of stdout, counts/discards stderr with a 4 MiB limit,
and admits only typed safe metadata. Raw JSON, provider errors, artifact/log
URLs and credential identifiers are never uploaded or printed.

## Exact source and request

`phone11-siprix-ios-build.yml` accepts manual dispatch only. The protected build
job runs only in `vasavas1977/codex-phone11` on
`refs/heads/codex/phone11-zoom-mainline-integration-20260928`, after daily-use,
native and signing-boundary offline checks pass. Both checkout SHA and required
`source_sha` input must equal the independently reviewed published SHA.
`build_profile` has only `preview-ios-siprix-daily-pilot` as a choice.

The source guard runs before CLI installation or token use, and runs again in
the parent and protected child. It rejects dirty tracked source, arguments,
Node/TLS/API/Apple-auth overrides and profile/environment injection. Permissions
remain `contents: read`; persisted checkout credentials are disabled. The pinned
Expo setup action receives no token and
[skips authentication when none is supplied](https://github.com/expo/expo-github-action/blob/c7b66a9c327a43a8fa7c0158e7f30d6040d2481e/src/actions/setup.ts).
Only the guarded parent step receives the existing `EXPO_TOKEN`. No new
credential or local authentication file is accepted.

The child validates EAS package identity/version `23.2.0`, fixed toolcache
custody, and SHA-256 of its entrypoint and critical compiled modules before
loading the CLI. Pins were obtained from the published npm package whose
SHA-512 integrity was checked, with no package installation or credential use.
An unknown package/export/layout refuses. CLI arguments are fixed to iOS,
daily-pilot, `--non-interactive --freeze-credentials --wait --json`; there is no
refresh, auto-submit, local, arbitrary profile or retry flag.

## Existing remote ad-hoc credentials only

`IosCredentialsProvider.getRemoteAsync` bypasses the setup selectors. It uses
[getBuildCredentialsAsync](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/credentials/ios/actions/BuildCredentialsUtils.ts)
with only `AD_HOC`, through the pinned
[read-only GraphqlClient lookup](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/credentials/ios/api/GraphqlClient.ts)
that queries an existing app identifier and existing app credentials. This
avoids the create-or-get identifier helper used by ordinary certificate setup.
Exactly one existing credential record must be returned. No enterprise fallback
or credential selection occurs. All other iOS credential API functions, local
reads, assignment/setup and Apple authentication are replaced with refusal.
Noninteractive push-key setup returns without mutation.

Before credential use, the provider requires the fixed project/owner/slug,
registered bundle, one application target, internal distribution, frozen
noninteractive context and no Apple auth or refresh. Evaluated Expo config must
retain the standalone daily-pilot runtime, OTA off, production APNs, chat flags,
Siprix 1.0.40 trial, legacy native architecture and no store/Android trial gates.
It checks certificate dates, exact profile team/application/APNs identity,
debugging off, ad-hoc devices present/nonduplicated/well-formed, expiry and
Expo's pinned local profile/certificate association validator. Existing secret
bytes are copied unchanged into the same target-map shape expected by Expo;
none are serialized into a receipt. Missing, expired, conflicting or malformed
credentials refuse without generation, assignment, authentication or fallback.

This validates existing data for the request, not Apple server revocation or
current intended-handset coverage. Those remain separate signed-package gates.
No device list is printed or independently collected during preparation.

## Output, failure and release limits

The parent admits exactly one bounded JSON record, rejecting duplicate keys,
malformed UTF-8/JSON or excessive depth. It requires a valid UUID, FINISHED,
IOS, INTERNAL, the fixed project/owner/slug/profile/app/version, exact submitted
SHA and a canonical decimal build number greater than retained signed Build123.
The floor is pinned in source; request input and environment cannot lower it.
Build123 is the verified internal trial artifact from source
`237983ee5ef005758a6ca4a5cd008de54cd97e8f`; package verification does not establish
installation or physical acceptance. It reconstructs
the fixed Expo details link from that UUID. Default-fragment private fields are
discarded, and errors never enter the safe receipt. A finished metadata record
still states artifact/install/physical acceptance and retry authority false.

The parent imposes a 119-minute deadline. Timeout, cancellation or stream-limit
failure terminates the detached child group, escalates to SIGKILL after five
seconds, clears timers/listeners and wipes retained buffers. Failures publish
constant codes only. The dedicated small diagnostic stream accepts only owned
codes and a conservative request-may-have-occurred flag. Unknown/missing
diagnostics, interruption or invalid success output leave submission ambiguous;
they never establish build absence or authorize another request. Use the
separately reviewed metadata-history path to inspect scoped provider state
before any later operator decision; an empty bounded history still proves no
exhaustive absence.

No exact next build number is predicted. Remote auto-increment is retained;
the result must prove a number above123. After submission, separately bind the
safe source receipt to actual IPA bytes and run the current signed/native/trial
gates. Preserve Build123 and earlier rollback IPAs. No development launcher, store
release, unrestricted license, artifact relabeling or handset replacement is
authorized by this source.

Focused offline validation:

```sh
node --test tests/phone11-ios-existing-build.test.mjs
```

Credential fixtures are synthetic and credential-free. They exercise reuse/map preservation,
mutation/local/auth refusals, profile/identity/expiry/device failures, exact source
guards, safe result admission, the legacy privacy failure, real synthetic child
capture, stream limits, timeout/cancellation, failure diagnostics and the actual
unmanaged entrypoint. They do not execute EAS, read signing credentials or submit
provider requests.

The configuration regression also evaluates the actual `app.config.ts` with the
locked installed `@expo/config` 12.0.12. A fresh minimal scratch project contains
only required source files and the existing dependency symlink; the child starts
with PATH only and applies public environment values from the owned profile.
It reads no workspace `.env`, private process environment or credentials, runs
no config mods/provider calls, installs nothing, and has no optional skip. It
checks all 13 fixed config fields, missing/enabled OTA and identity/trial refusal,
and unchanged absence of an explicit updates flag in the nonchat trial/wake profiles.

The first guarded request at `aa1b58fb714b4da33a90728641fd237b26fac697`
refused with `CONFIG_REFUSED`. Offline exact-source evaluation reproduced the
cause: `updates.enabled` was absent, while the strict guard required literal
`false`; the old synthetic config fixture supplied that field and hid the gap.
Expo's native updates default uses URL presence when the flag is absent, so
native OTA-off evidence does not imply the JS config contains an explicit flag.
The commissioned daily chat pilot now explicitly sets `updates.enabled: false`.
Nonchat trial/wake profiles preserve their existing behavior. Every
commissioned-chat config, including the gated `production-ios-siprix-store`
profile, receives `updates.enabled: false`. All store, license, signing and
credential/config gates remain unchanged; this establishes no store-release
proof. Offline success admits corrected source only: the first request
still reports `requestMayHaveOccurred: true`, establishes no build absence and
authorizes no retry, signing, artifact or device acceptance.

The next exact-source dispatch at `013926c455788a316d82c00b93733aa7ff2d29b4`
failed its offline signing-guard prerequisite. The new real-config regression
requires installed locked Expo dependencies, but that job previously ran tests
immediately after checkout. A clean source-only offline reproduction fails with
`ENOENT` for `node_modules`; this is a job prerequisite defect, not a credential
or provider result. The preflight now uses the workflow's established Node 22
and pnpm 9.12.0 setup, followed by `pnpm install --frozen-lockfile --ignore-scripts`
before the mandatory full suite. Its timeout is ten minutes to include dependency
setup. It receives no provider token and executes no dependency lifecycle scripts.
No configuration test is skipped, and all build/source/credential gates remain.
Local validation reuses installed dependencies and checks the job structure;
an actual fresh-runner install remains hosted CI evidence. This correction
provides no build retry authority or provider/build-absence proof.
