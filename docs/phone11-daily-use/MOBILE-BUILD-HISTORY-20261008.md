# Phone11 mobile build history: metadata only

This route prepares a bounded authenticated history check for the prior Android
foreground-trial request and current daily-pilot iOS profile. Source preparation
and offline tests do not verify that the existing `EXPO_TOKEN` is available,
valid, or authorized for this project. No authenticated request, dispatch, build,
credential change, artifact download or app installation was performed to prepare
this route. Publishing this source does not authorize a build retry.

The workflow runs offline tests on scoped pull requests and integration-branch
pushes, without an Expo token. The metadata job depends on those tests and runs
only on a manual dispatch in `vasavas1977/codex-phone11` at
`refs/heads/codex/phone11-zoom-mainline-integration-20260928`. Both jobs check out
the exact invocation SHA with persisted Git credentials disabled. Permissions are
`contents: read`. Only the guarded reader step receives the existing `EXPO_TOKEN`;
there is no Expo action, package installation, CLI invocation, artifact upload or
raw provider log output. Node's built-in HTTPS client and the runner's Node runtime
are sufficient. The reader checks the managed invocation and actual local Git
HEAD before reading that environment token.

## Proven transport and privacy boundary

The transport is one fixed HTTPS POST to `https://api.expo.dev/graphql`, carrying
only the literal `Phone11MobileBuildHistory` GraphQL **query** and the fixed project
variable. Expo's [production API base](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/api.ts)
and [GraphQL client](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/commandUtils/context/contextUtils/createGraphqlClient.ts)
establish this endpoint and Bearer access-token header. Its
[BuildQuery](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/graphql/queries/BuildQuery.ts)
uses `app.byId(appId: String!).builds(offset: Int!, limit: Int!, filter: BuildFilter)`.
The [generated schema](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/graphql/generated.ts)
and [BuildFragment](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/graphql/types/Build.ts)
confirm the selected fields and nullable metadata.

The direct query avoids dynamic app-config evaluation and the CLI's default
fragment, which also selects private errors, logs and artifact URLs. This is a
smaller privacy surface; it is not a claim that fixed noninteractive `build:list`
creates a project. Expo's
[project-ID resolver](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/commandUtils/context/contextUtils/getProjectIdAsync.ts)
rejects the missing-project initialization path in noninteractive mode. This
reader has no configuration discovery, authentication setup, account mutation,
credential resolver, build request, redirect following or retry.

The request uses normal certificate verification, a fixed hostname/path, no
custom HTTPS agent, no compression, a 15-second total deadline and a 256-KiB body
limit. It refuses TLS/injection overrides in the guarded runtime. Raw response
bytes exist only in bounded memory. Fatal UTF-8, JSON depth, duplicate-key,
schema, identity, bucket-size and duplicate-build checks run before any output.
HTTP/provider/GraphQL failures produce only a constant symbolic failure code.
Private provider exception text, errors, log/artifact URLs, email addresses and
arbitrary strings are never copied into a report. Unknown fields refuse the
entire response. An exact token substring in a proposed success report also
refuses output. Failures deliberately discard any partial metadata.

## Fixed scope and allowed output

Project is `e354ffd3-485c-49f1-9e6f-aebe571d8dfb`, owner `vasavas`, slug
`phone11ai`. Each returned build must repeat this exact project identity.
All three buckets have offset zero and request `INTERNAL` distribution:

| Bucket | Limit | Platform/profile | App identifier | Source filter |
| --- | ---: | --- | --- | --- |
| priorAndroid | 20 | ANDROID / preview-android-siprix-foreground-trial | ai.phone11.mobile.foregroundtrial | 04f80dfa5c501df7a6aae10249cbb8e510a4898c |
| recentAndroid | 10 | ANDROID / preview-android-siprix-foreground-trial | ai.phone11.mobile.foregroundtrial | none |
| dailyPilotIos | 10 | IOS / preview-ios-siprix-daily-pilot | space.manus.phone11ai.t20260425073427 | none |

The only copied provider values are a validated lowercase UUID, a status from
`NEW`, `IN_QUEUE`, `IN_PROGRESS`, `PENDING_CANCEL`, `ERRORED`, `FINISHED`, `CANCELED`,
the approved platform/profile, `INTERNAL`, the fixed app identifier, fixed version
`1.0.0`, a positive decimal build number (maximum 18 digits) and a lowercase
40-hex source SHA. Build-details URLs are reconstructed as
`https://expo.dev/accounts/vasavas/projects/phone11ai/builds/<validated UUID>`.
No provider-supplied URL is accepted. Fixed scope constants, reader SHA, counts,
typed states and acceptance flags are local report data.

Project identity, platform and profile must always be present and exact. Nullable
distribution/app identifier/version/build number/source metadata is omitted and
marked `METADATA_INCOMPLETE`. Wrong nonnull identity/version or malformed values
refuse the whole report. `sourceMatch` is `MATCH`, `OTHER_SOURCE` or `UNAVAILABLE`:
the prior bucket compares against its fixed request source; recent buckets compare
against the exact workflow checkout SHA. Only valid exact SHA matches increment
`exactSourceMatchCount`. Null source never counts as a match.

Aliases can overlap Android records; no unique overall count is claimed.
Repeated IDs within a bucket refuse, and overlapping records must agree on all
metadata. Every bucket states `exhaustive: false` and `absenceEstablished: false`.
Filters, bounds, unavailable metadata, provider access and pagination prevent an
empty list from proving that a remote build was never created.

`firstDailyPilotIos` identifies the first returned iOS record, without reordering
or comparing build numbers. `orderBasis: EXPO_FIRST_RESULT_OFFSET_ZERO` follows
Expo's own [getLatestBuildAsync](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/build/queries.ts),
which uses limit one, offset zero and returns the first result. This is the Expo
helper convention, not an independently verified global chronology guarantee.

## Release boundary and validation

Every report, including failure, states `artifactVerified: false`,
`installed: false`, `physicalAcceptance: false`, and `retryAuthorized: false`.
`authVerified: true` means only that this query produced fully validated project
metadata. A `FINISHED` status does not establish signed-package identity, artifact
availability, entitlements, provisioning, installation or handset acceptance.

The existing [mobile trial inputs](MOBILE-TRIAL-RELEASE-INPUTS-20261006.md),
[Android trial build gates](ANDROID-TRIAL-INTERNAL-BUILD-20261007.md) and
[signed release handoff](SIGNED-INTERNAL-RELEASE-HANDOFF-20260916.md) remain the
authority for any separately authorized build, signed-package verification,
credential custody and device acceptance. Preserve the signed iOS pilot and
rollback IPAs. Do not admit an automatic retry from this report or infer a
production/store release or Siprix entitlement.

Run the no-token suite with
`node --test tests/phone11-mobile-build-history.test.mjs`. It exercises synthetic
responses only: status/identity/source constraints, nullable metadata, overlapping
records, private-field refusal, escaped duplicate keys, malformed UTF-8/JSON,
response limits, truncation, redirects, network errors, timeout, missing tokens,
managed-invocation guards, credential echo refusal and exact workflow boundaries.
No live provider response has been used as a fixture. Independent critical-output
review is required before the lead publishes or dispatches this route.
