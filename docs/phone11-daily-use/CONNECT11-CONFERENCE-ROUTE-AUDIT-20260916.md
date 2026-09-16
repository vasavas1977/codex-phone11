# Connect11 conference route audit — 16 September 2026

**Decision: keep Phone11 meetings unavailable.**

This audit separates the reviewed Connect11 source contract from the currently
observed public API. It does not create a room, issue a token, enable a worker,
or make a configuration change.

## Reviewed source boundary

| Item | Verified source fact |
| --- | --- |
| Contract | `phone11-conference.v1` defines scoped capability, token, and agent-arrival routes. |
| Goal 25 implementation | Connect11 PR #88 merged as `14b2e481dd06c7d370fac6e216aaf99bcbe289e0`; its implementation head is `8d3fd36ce3333c926eab24e839e960e4746544dc`. |
| Ledger record | Connect11 PR #89 merged as `8f3de9d4c0b4d7631b6226805c9967c25ae1ba4d`. |
| Default state | Source infrastructure keeps conference disabled, its issuer-isolation attestation false, the Phone11 language list empty, and no Phone11 customer credential active. |
| Phone11 integration | The checked-in Phone11 facade and admission-provider bridge remain unmounted. `meetings.capabilities` remains false and `meetings.join` has no provider. |

## Read-only public API observation

On 16 September 2026, the following unauthenticated, read-only requests were
made against `https://api.connect11.ai`:

| Route | Observed response | Meaning |
| --- | --- | --- |
| `GET /api/v1/health` | `200` | A Connect11 service is reachable. This is not conference readiness. |
| `GET /api/v1/ready` | `200` | The deployed service reports ready. This is not a conference-worker or media check. |
| `GET /openapi.json` | `200`; no `/api/v1/realtime/conference` paths | The public deployment does not publish the Phone11 conference facade. |
| `GET /api/v1/realtime/conference/capabilities` | `404` | The required capabilities route is not exposed by the observed deployment. |
| `GET /api/v1/realtime/conference/agent-arrivals/<synthetic UUID>` | `404` | The required arrival route is not exposed by the observed deployment. |

No token route was called because a safe token request requires a scoped
server-only credential and a real authorized admission. A token cannot be used
as a route-discovery probe.

## Readiness matrix

| Gate | Status | Evidence or missing evidence |
| --- | --- | --- |
| Versioned source facade | **source complete** | Merged Goal 25 source defines `phone11-conference.v1`. |
| Deployed facade endpoints | **not ready** | Required public routes return `404`; OpenAPI omits them. |
| Phone11 namespace / issuer isolation | **not ready** | Source default is false; no deployed alternate-issuer rejection or dedicated project evidence. |
| Phone11 admission and membership | **source only** | Resolver and migration are unmounted/unapplied; lifecycle and revocation need an operational review. |
| Room and short-lived participant token | **not ready** | No deployed facade or scoped Phone11 credential evidence; no token was minted. |
| Interpreter and voice bot | **not ready for Phone11** | No deployed conference-worker registration, durable arrival observation, or translated `out-<language>` media proof. |
| Native and handset acceptance | **not ready** | No signed iOS/Android build proving coexistence with Siprix, then authorized two-device audio/video/reconnect testing. |

## Required next evidence

1. Deploy the exact reviewed Connect11 revision and publish the three
   `phone11-conference.v1` routes behind server-only scopes.
2. Record deployed issuer-isolation evidence for every alternate and legacy
   issuer, or prove dedicated media credentials.
3. Register and prove the conference worker, arrival storage, language
   allowlist, and an `out-<language>` track.
4. Apply Phone11's reviewed admission migration and wire the provider only in a
   separately reviewed backend change.
5. Test on signed iOS and Android builds with authorized physical devices,
   including ordinary Phone11 voice-call regression.

Until all relevant evidence is attached, Phone11 must show the existing
setup-pending meeting state and must not issue tokens or claim video,
interpretation, voice-bot, captions, or recording availability.
