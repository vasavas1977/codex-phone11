# Authenticated meeting adapter seam

Source only. No deployed API, worker, credential, or handset acceptance is implied. `meetingsRouter` is mounted as `meetings` in the root tRPC router. Both routes require existing authenticated Phone11 context. Capabilities always report unavailable; the default join route has no provider and cannot issue tokens. There is deliberately no activation environment flag.

`createMeetingService` supports an explicitly injected isolated provider and current repository membership. `createIsolatedCoreGuardProvider` reuses the audited `/get-livekit-token` contract with server-only credentials and server-derived tenant/meeting room and user identity. It only requests `video_only`, with no conference/translator fallback or worker dispatch. Signed short-lived JWTs must match the configured media endpoint, issuer, participant and room, with no administrative grants. Errors returned to clients exclude upstream payloads. Tokens must never be logged or persisted by the caller.

Before wiring the provider: verify a dedicated LiveKit project or equivalent enforced isolation across ALL token issuers; the audited Alert11 arbitrary-room issuer must not grant Phone11 room access. Review the draft migration against actual tenant membership schema, provision meeting members through an authorized workflow, implement token rate limits and immediate removal/revocation for participants already connected, verify expiry/rejoin behavior, and then explicitly change capabilities together with production wiring. The schema is not applied automatically. Current tokens can remain valid for up to five minutes; membership removal alone cannot evict an already connected session.

AI interpretation, voice bot, recording and transcript storage remain unavailable pending existing backend discovery and separately verified consent, ownership and lifecycle contracts. This seam adds no duplicate AI worker and no invented live URL.

Run: `node_modules/.bin/vitest run server/meetings/meetings.test.ts`.
