# Phone11 owned-auth production checkpoint

## Source and scope

- Auth source: `a4d2ad1f8ee1f84200204839e28f107477cf8365`.
- Repair branch: `codex/phone11-owned-auth-20260909`; legacy push-deploy branch untouched.
- User approved owned-login production cutover and sign-in account creation with
  "continue till done" after the explicit approval request.
- SIP credential rotation, carrier routing, purchasing and PSTN calls were not performed.

## Observed recovery

The canonical PostgreSQL database used by the running API had zero `users` rows.
Existing extension 1001 belonged to numeric user 1 and was explicitly primary in
`user_extensions`; extension 1020 remained non-primary. Both discrete `PG_*` and
`DATABASE_URL` identified that same database.

Before writing, the operator retained the old runtime/container configuration and
a 45,194-byte PostgreSQL custom-format dump. Its `pg_restore --list` catalog parsed
successfully (132 lines); a full restoration rehearsal was not performed.

The reviewed migration created only prefixed authentication tables and indexes.
The guarded operator recovery restored canonical user 1 with role `user` (not
admin), then created its explicitly approved email/password identity. Random
credentials and the new auth signing secret stayed in owner-only files, outside Git
and tool output. A private local sign-in handoff was created for the owner.

## Deployed backend

- Container: `cp11-backend`, new image
  `sha256:2650f05466f9a3c849c26f9239b26f0c8fce5d225dedb404610325b112bbed09`.
- Active Compose file:
  `/opt/phone11ai/auth-recovery-20260909/compose.active.json`.
- Private runtime environment and retained recovery evidence are in the same
  owner-only server directory. The Compose file uses the exact image ID.
- Existing Docker network and backend alias retained; API binding remains
  `127.0.0.1:3000`, with the existing HTTPS nginx proxy.
- Exact trusted proxy: existing Docker gateway `172.18.0.1/32`.
- Existing recordings/voicemail storage was copied to a persistent mounted directory.
- Previous container retained stopped as
  `cp11-backend-pre-owned-auth-20260909`, with automatic restart disabled.
- Private candidate container retained stopped after acceptance.

Use the active Compose file for this deployed service. Do not run an old branch's
redeploy script or automatically restore the retired session-injection routes.

## Acceptance evidence

Private candidate and public `https://api.phone11.ai` checks both passed:

| Check | Result |
| --- | --- |
| Build health | HTTP 200, exact auth source SHA above |
| Auth schema/identity readiness | HTTP 200, ready=true |
| Mobile config | Phone11 email/password enabled, public signup disabled |
| Real password login | HTTP 200, signed native session returned |
| Canonical profile | HTTP 200, user ID 1 |
| Authenticated phone.getConfig | HTTP 200, primary extension 1001, current 36-character credential |
| Durable sign-out | HTTP 200 |
| Reuse of revoked session | HTTP 401 |
| SIP state comparison | All five pre/post table digests identical |

The unchanged tables were `extensions`, `user_extensions`, `sip_accounts`,
`subscriber` and `did_numbers`. Digests and credential values are not published.

Focused rerun: 68 PostgreSQL/HTTP/schema tests passed, 52 client/UI tests passed,
12 SIP-isolation/logout tests passed. The optional rendered-browser test was skipped
in this rerun; it passed during the preceding isolated implementation phase.

## Native build gates

The first EAS build reached signing with the existing certificate/profile and
registered handset, then failed in Xcode compiling fmt:
`51869357-f87c-4d6f-9ea3-cfe4477af673`.
The exact compiler errors were retrieved through a read-only, secret-redacted
GitHub workflow rather than inferred from the generic failure screen.

The preview profile is now pinned to Expo's documented SDK 54 image
`macos-sequoia-15.6-xcode-26.0`, instead of the moving `latest` image.
Signed build retry: GitHub run `34303826173`, source `4e8464639f341a63129a465155cf59763d8eea43`.

Official Siprix sample compile/link and arm64 artifact checks passed for device
and simulator in GitHub run `34303687602`. This is unsigned SDK trial evidence only:
no install, SIP registration, CallKit, PushKit or PSTN claim. The upstream sample
retains a 60-second trial and unfinished PushKit receive handling.

## Remaining phone-call blockers

- USB device discovery returned no attached iPhone during this run.
- The existing FreeSWITCH container was observed exited/OOM-killed, despite stale
  Docker listing text. Restart approval was requested separately and is still pending.
- No DID rows exist in the API's `did_numbers` table; incoming carrier routing needs
  independent inspection, not an assumed working assignment.
- Phone11's native adapter is still PJSIP. Siprix is selected but not integrated.
- Updated app installation, fresh handset registration, outbound and inbound PSTN,
  answer/hangup state and two-way audio have not yet passed.

References: [Expo build images](https://docs.expo.dev/build-reference/infrastructure/),
[signed iOS retry](https://github.com/vasavas1977/codex-phone11/actions/runs/34303826173),
[Siprix compile evidence](https://github.com/vasavas1977/codex-phone11/actions/runs/34303687602).
