# Phone11 outgoing recording controls — Build 45

Date: 2026-09-14. Build 45 and server updates are installed; physical outbound acceptance is pending.

## Problem and repair

The user could place a mobile/PSTN call, but recording remained at “Waiting for
call controls.” Live routing inspection confirmed authenticated outbound calls
already traverse FreeSWITCH. Its static outbound XML dialplan did not invoke
the backend outbound recording binder, and the app had no shared outbound
history identity. There were no outbound recording routes to match.

The native iOS bridge now generates one UUIDv4 before each outgoing invitation,
adds only the fixed `X-Phone11-Outbound-ID` SIP header, and preserves the matching
`native-outbound:<uuid>` history ID through termination. JavaScript callers
cannot supply arbitrary SIP headers. Ordinary outbound history is excluded
from the completed incoming-wake spool.

Kamailio removes every client copy of the three recording identity headers.
Only successful digest authentication for the commissioned 3001 account and
realm, a single valid UUIDv4, and an ordinary PSTN destination produce canonical
metadata. The hook changes no media or call route. FreeSWITCH copies those
three headers to internal A-leg variables and unsets the SIP header variables
before the existing transfer/bridge, preserving carrier caller identity headers.

The authenticated ESL scanner requires an inbound FreeSWITCH A-leg with logical
outbound direction, exact observed proxy source `10.0.1.69`, profile `external`,
normal media mode, and one active authenticated SIP account. It creates route
and cloud history identity atomically. Concurrent retries are idempotent;
reused IDs, ambiguous ownership, and changed channel/SIP identity fail closed.
Matching does not use phone numbers or time proximity. Missing metadata leaves
ordinary calling available. Workspace recording policy is unchanged. A fresh read confirmed the pilot
workspace uses automatic recording; a connected call should announce and
record automatically, exposing Stop recording.

## Verified source and deployment

- Mobile source: `7cf7057b3595f31b2c08cdc89b0ba857a2ad709c`.
- Server source: `a1317645ac8496f602b9e6fecf9e1bc17eaab058`.
- Kamailio helper and digest fixture: `8b7f9fb`.
- Server CI `34860460665`: all five daily-use jobs passed, including the new
  isolated PostgreSQL ownership/concurrency suite.
- Primary independently reran 39 focused server tests successfully.
- The exact live Kamailio 5.8.4 image passed 12 isolated digest/SIP cases with
  no network access or published ports; the full staged live configuration
  also passed the actual-image parser. Private full configs were not committed.
- Backend candidate health passed before replacement. At 15:17:10 UTC, exact
  source a131764 was healthy both locally and publicly; ESL authenticated and
  subscribed. Image:
  `sha256:922aa54592c66755ba7190562491906b43ac0841e60491cedfc68b899d861e2d`.
- The replacement retained current environment, persistent mounts, and the
  exact backend network address. Kamailio and FreeSWITCH containers were
  unchanged by the backend replacement.
- Fresh guard required zero FreeSWITCH channels, Kamailio dialogs, active
  captures, and processing AI jobs immediately before backend replacement.
- Private candidates, parser/build/probe logs, results, and rollback files:
  `/opt/phone11ai/outbound-recording-20260914` on the server.

## Installed iPhone

Signed workflow `34859879958` passed native and all daily-use gates at the exact
mobile source. EAS build `d0dbb69a-8675-4eae-9d67-c2b3bb08e9c4` finished with
version `1.0.0 (45)`, bundle `space.manus.phone11ai.t20260425073427`.
Strict/deep signature verification, production APNs, Ad Hoc device inclusion,
and provisioning validity passed. IPA SHA256:
`0ef0f1e951c220fad8a4711e964a261669049cbbba4004db6f0657d07f80111c`.
After a fresh server idle guard, installation and launch succeeded; installed
inventory independently confirmed Build 45 and the running app process.

## Live metadata commissioning

The actual pinned FreeSWITCH image passed the isolated fixture twice. Baseline
and candidate each preserved all four number routes and caller identity
headers. Candidate dumps contained the exact internal A-leg nonce/user/realm,
expected inbound/logical-outbound directions, observed source peer, external
profile, and normal media mode. None of the protected SIP headers reached the
carrier. Fixture source: `082895d668bbd11a12321be95cd9af5e56fd32af`.

Source `437339148268c3a180ed4840eda8097689c39369` commits the outbound XML and
adds the real digest and FreeSWITCH regression fixtures to daily CI. Its XML
SHA256 is `08c1926902d78203f6708e1a25f76014451ac4d7e92f2fdafdab60b2ea3a4493`.
The live staged full Kamailio configuration passed the actual-image parser;
independent integration review found no blockers. Live application required a
matching fixture proof hash and fresh zero-channel/dialog/capture/job guard.
FreeSWITCH reloaded XML without restart; Kamailio restarted and answered its
real JSON-RPC readiness check. The exact backend health remained healthy.

The first rollout verifier expected a Docker HEALTHCHECK that this existing
Kamailio container does not define. It restored the prior configuration; the
verifier was corrected to use the actual Kamailio RPC before successful retry.
Private `metadata-result.json` records the completed rollout and source hashes.
Build 45 is running, and the user has been invited to test the outgoing call.
Final daily-use CI `34863247928` passed all five jobs at exact source
`437339148268c3a180ed4840eda8097689c39369`, including both new real-service
SIP fixtures.

## Acceptance still required

One outgoing call from the installed iPhone must establish two-way audio,
automatically play the announcement and show Recording in progress, stop
capture successfully, and expose
playback plus AI summary/transcript in Recents. Installation, CI, SIP metadata,
and server health do not constitute this handset proof.

The shared history store and controls support the exact outbound identity;
this local Siprix module has no native Android adapter. An Android package and
native Android acceptance are not claimed. Earlier calls for which capture
never started cannot acquire a recording retroactively.
