# Connect11–Phone11 adapter handoff — 2026-09-16

**Status: disabled, source-only handoff.** This document records the source
contract reviewed in Connect11. It does not establish a deployed API, worker,
credential, isolated media project, or handset acceptance. Keep every Phone11
meeting capability unavailable until the gates below have evidence.

## Reviewed sources

| Source | Revision | Meaning |
| --- | --- | --- |
| Connect11 Phone11 conference contract | `170cbe8d779509f7a5bfe9756fd51e9ab387549c` | PR #85 merged the fail-closed `phone11-conference.v1` source contract. |
| Connect11 ledger backfill | `a2c0c7461ad63ecc90fed7196dbd4198e8863812` | PR #86 records Goal 24 as merged-not-deployed; it does not add a deployment. |
| Phone11 meeting seam | `319741d` in this checkout | `meetings.capabilities` stays unavailable and `meetings.join({ meetingId })` has no provider wired. |

## Canonical Connect11 S2S contract

Base path: `/api/v1/realtime/conference`. Phone11 calls these routes only from
its authenticated server. No end-user app, browser, or handset receives a
Connect11 API key or calls the routes directly.

| Endpoint | Required scope | Required handling |
| --- | --- | --- |
| `GET /api/v1/realtime/conference/capabilities` | `realtime:conference:status` | Treat `available: false`, an unknown contract version, malformed response, or an empty language list as unavailable. Never guess a language or fall back to another issuer. |
| `POST /api/v1/realtime/conference/tokens` | `realtime:conference:join` | Send only opaque Phone11 `meeting_id` and `participant_id`, an advertised two-letter `listen_language`, `interactive` or `listener`, and a fresh matching consent assertion. The generic `realtime:token` scope does not authorize this route. |
| `GET /api/v1/realtime/conference/agent-arrivals/{observation_id}` | `realtime:conference:status` | Poll only after a successful token response. An arrival result is not proof of current presence, healthy audio, translated output, or active interpretation. |

The contract version is `phone11-conference.v1`. A successful token is fixed at
300 seconds and includes `rtc_url`, `access_token`, `expires_at`,
`arrival_observation_id`, and `arrival_state`. Token minting prepares the
idempotent interpreter dispatch; there is no separate start endpoint. The
version has no stop, room-termination, worker-command, current-presence, or
health endpoint, so Phone11 must not expose a Stop interpreter control.

Connect11 derives the room as `org_<tenant>--phone11-<derived-meeting>` and a
meeting-bound participant identity using its dedicated HMAC key. Phone11 must
not substitute its legacy `conf-p11-*` coordinates, provider room name, or
provider identity. Join-time attributes are immutable: `mode=conference` and
`lang=<listen_language>`. Compatible workers publish translated tracks as
`out-<language>`; seeing the expected track is separate client-media evidence.

## Disabled integration rules

1. The Phone11 mounted router remains disabled: its capabilities are all
   `false` and its default join route has no injected provider. Do not add an
   environment switch or wire `createIsolatedCoreGuardProvider` as a shortcut.
2. Do not call the generic Connect11 realtime token route, a public/demo
   minter, the legacy `/get-livekit-token` adapter, or the Alert11 incident
   issuer for a Phone11 conference room. The legacy adapter is video-only and
   cannot satisfy this conference contract.
3. Do not place a Connect11 credential in a mobile app, browser, local storage,
   logs, analytics, error messages, or a client-readable configuration value.
4. Do not treat a source rejection of `org_<tenant>--phone11-*` as deployment
   proof. The server-side issuer-isolation attestation defaults to `false` and
   callers cannot set it.
5. Do not activate interpretation, voice bot, recording, captions, or video as
   a bundle. Each capability needs its own reviewed lifecycle, ownership, and
   acceptance evidence. Recording remains off without its separate durable
   notice, consent, session, access, retention, and audit contract.

## Missing deployment proof

The current source is intentionally insufficient. Before any capability changes
from `false`, record evidence for all applicable items:

- deployed Connect11 API revision and exact facade URL, with a scoped
  server-only Phone11 credential;
- `CONNECT11_PHONE11_ISSUER_ISOLATION_VERIFIED=true` only after testing the
  exact derived Phone11 room against every alternate, legacy, public/demo, and
  external issuer, or proving dedicated media credentials/project isolation;
- deployed conference mode, RTC credentials, dedicated HMAC key, consent-policy
  version, nonempty approved language allowlist, persistent arrival evidence,
  and registered production conference worker;
- Phone11 tenant and meeting authorization, active/non-revoked membership,
  migration review, rate limiting, token expiry, and eviction or documented
  rejoin behavior after membership removal;
- synthetic, authorized two-device acceptance on signed iOS and Android builds:
  admission isolation, two-way media, controls, reconnecting, SIP interruption,
  expected language track, and normal Phone11 calling regression.

## Phone11 wiring sequence after every gate passes

1. Query capabilities from the Phone11 backend with only
   `realtime:conference:status`; retain the unavailable UI unless the exact
   contract returns `available: true`.
2. Reauthorize the authenticated user against the intended Phone11 meeting and
   derive the opaque meeting/participant references server-side. Build and store
   the durable Phone11 consent record separately, then create the required
   short-lived consent assertion for each mint.
3. Call `POST /tokens` from the backend using only
   `realtime:conference:join`; return the short-lived participant connection
   result to the authenticated app over Phone11's existing protected channel.
   Never return the S2S credential or provider diagnostics.
4. Poll the scoped arrival endpoint. Present interpreted audio only when both
   arrival evidence and the expected `out-<listen_language>` media track have
   been observed. Show failures truthfully and keep ordinary meeting media
   subject to policy.
5. Recheck membership on every mint. On revoke, use the deployed eviction path
   or force documented expiry and rejoin; clear client media before SIP assumes
   audio ownership and require an explicit resume.

## Acceptance decision

Until the preceding deployment, isolation, and handset evidence is attached to
the release, the correct state is **setup pending**: no token, interpreter,
bot, recording, or live claim. `170cbe8d` and `a2c0c746` establish a reviewed
source boundary only; neither authorizes a deployment or activation.
