# Conference ownership handoff — 2026-09-21

The owner explicitly requested coordination to stop duplicated conferencing
work across the two tasks. Phone11 has read and accepted Connect11's proposed
ownership boundary. A coordination message was successfully delivered to the
Connect11 task on 21 September, requesting one bounded read-only provider-log
investigation. This supersedes the earlier failed task-message delivery.

## Single-writer boundary

- **Complete Phone11 UCC task** (`01a0891d-0d3b-7013-ac12-ff966856b2d5`):
  sole owner of Phone11 conferencing client fixes, native lifecycle,
  signed builds, installation, and handset acceptance, alongside its existing
  Phone11 server/profile/chat work.
- **Complete Connect11 project** (`01a04460-f510-76a3-89e6-2e0215b24cc4`):
  no further Phone11 client edits, build dispatches, installations or device
  tests. Retains Connect11 service/provider-side investigation only when an
  explicitly bounded backend need is identified. No speculative backend change.
- The two existing read-only Connect11 workers are concluding evidence handoff;
  no replacement implementation worker will be started for Phone11.

## Latest handset evidence

- Build 77 source: `1f0fabc9a095e7f1c5d8d51f4097bb48ac0d8b45`.
- EAS: `66e8f36e-cc3c-4390-843a-539dc7cd6ac9`.
- IPA SHA-256: `4f9f31de9378a214179bf1bf9c1916ddb094d7240b1347f6f7115ac84ea31c2f`.
- First phone installation/inventory verified at approximately 01:17 ICT on
  September 21. The owner subsequently reported **Reference: room_connect**.
  Second phone was last verified on Build 75; do not assume Build 77 there.
- Admission and manual audio startup completed. This does **not** prove a
  successful provider WebSocket join or media connection.
- `room_connect` wraps Room construction, event binding, SDK room.connect,
  post-connect refresh and cancellation. Camera/microphone permission rejection
  is nonfatal in this adapter and does not by itself explain this reference.

## Read-only findings and next discriminator

No concrete source root cause or package incompatibility was established.
Build 77 resolves one peer-compatible closure: React Native SDK 3.0.0,
namespaced WebRTC 144.2.0, and client 2.22.3. Its verified IPA contains the native
framework/module symbols. Existing provider evidence proves token issuance and
WSS-origin/TLS reachability, not acceptance of an authenticated WebSocket join.

Prefer correlating one bounded retry with provider connection logs before a
new fix. If unavailable, the Phone11 owner can add narrowly allowlisted
diagnostics distinguishing construction, event binding, connection and
post-connect stages, plus SDK connection reason/status enums. Never publish
SDK messages, contexts, stacks, URLs, tokens, room or participant identifiers.

Phone11 requested that Connect11 first inspect available historical connection
and admission logs for the reported Build 77 failure, without new meetings,
credentials, provider writes or handset test requests. If those logs cannot
correlate the failure, Connect11 should return the exact evidence gap and a
bounded capture procedure. Phone11 then coordinates one user retry. Build 77
remains the current test package; no additional build is justified yet.

Validation rerun this turn: installed Vitest directly; browser-session 9 tests
and native-session 9 tests passed (18 total). These mocked tests do not establish
real-device connection or audio/video acceptance. No runtime code was changed
and no build was dispatched this turn.

## Coordinated USB retry — 21 September, 01:35 ICT

- The owner connected the failing iPhone by USB and confirmed one requested
  join retry still returned `Reference: room_connect`.
- Connect11 correlated the only new request/token pair in that retry window:
  preceding request HTTP 200 at `2026-09-20T18:35:00.122Z`, token HTTP 200 at
  `18:35:00.190Z`. This establishes successful admission response, not provider
  WebSocket acceptance or media connection.
- Phone11-only syslog capture ran for three minutes. It retained allowlisted
  category labels/timestamps only, never raw log lines, tokens or identifiers.
  It saw 4,889 process lines but no allowlisted SDK reason/connection exception.
  Generic DNS/TLS/timeout mentions were also present during idle polling and
  are not evidence that DNS, TLS or a timeout caused the failed meeting.
- Provider historical console access is sign-in gated. The saved provider CLI
  configuration authenticated a read-only request to the deployed host, but
  this does not verify the deployed API signer credentials or handset token.
- Source inspection found no concrete static client/SDK mismatch. Phone11 owns
  a bounded diagnostic change to separate room construction, event binding,
  SDK connection and post-connect work and classify allowlisted reason enums.
  No root-cause fix or further handset success is claimed.

## Diagnostic update in progress

- Source `91fe9abdedf0ad0e5838172276a481d028143757` separates connection
  boundaries and maps only allowlisted SDK connection reasons and validated
  HTTP status codes into the existing Reference line. Raw SDK causes remain
  in memory and are not rendered. Validation: 35 focused tests and TypeScript
  passed; the lead inspected the diagnostic and adapter changes.
- Phone11 dispatched exactly one signed daily-pilot workflow:
  [35529898146](https://github.com/vasavas1977/codex-phone11/actions/runs/35529898146).
  Actual build number, package verification and installation remain pending.
  Do not label this a root-cause fix or ask for another retry on Build 77.
- Connect11 confirmed in-place provider authentication probing is unavailable:
  the running API service/task has ECS Execute Command disabled and no managed
  execution agent. No execution feature, credential or infrastructure setting
  was changed. Saved CLI credentials are separate evidence from API signer
  credentials and must not be substituted as proof.

## Verified diagnostic Build 78

Workflow 35529898146 finished successfully for exact source `91fe9ab` above.
EAS build `6e3c95a8-69d4-4733-9baf-d3bb320f532e` is FINISHED, internal daily-pilot,
version 1.0.0/build 78. Siprix/native bridge/strict signature checks and all 22
signed configuration/provisioning checks passed. Retained IPA SHA-256:
`fc48563af1d2d9bc312dddd14eb8c2b14cc63fe5699388e8a551172a8fc04040`.

[Install Build 78](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/6e3c95a8-69d4-4733-9baf-d3bb320f532e).
Update the failing phone in place and request one join attempt, reporting the
full new Reference line. The package is diagnostic-only: no root cause, actual
installation, provider join, or media success has yet been established for it.
