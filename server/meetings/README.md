# Authenticated meeting adapter seam

Source only. No deployed API, worker, credential, or handset acceptance is implied. `meetingsRouter` is mounted as `meetings` in the root tRPC router. Both routes require existing authenticated Phone11 context. Capabilities always report unavailable; the default join route has no provider and cannot issue tokens. There is deliberately no activation environment flag.

`createMeetingService` supports an explicitly injected provider and current repository membership. The only future conference integration path is `createConnect11MeetingProvider`, supplied with `createMeetingAdmissionResolver` and the versioned Connect11 facade. This is deliberately unmounted. Phone11 sends only trusted opaque meeting and participant references, a least-privilege profile, allowed language, and a fresh assertion backed by a durable interpreter-consent receipt. Connect11 derives the actual room and media identity. Tokens and upstream diagnostics must never be logged or persisted.

Before wiring the provider: preflight and apply the draft admission migration through the reviewed database procedure, provision rooms/members/receipts through authorized server workflows, and add atomic issuance leases that compare room/member/receipt revisions. Verify a dedicated LiveKit project or equivalent enforced isolation across ALL token issuers; the audited Alert11 arbitrary-room issuer must not grant Phone11 room access. Connect11 must also provide a verified eviction/revocation operation: with the current five-minute token, membership removal prevents reminting but cannot stop an already connected participant. Only then may capabilities change with production wiring.

AI interpretation, voice bot, recording and transcript storage remain unavailable pending existing backend discovery and separately verified consent, ownership and lifecycle contracts. This seam adds no duplicate AI worker and no invented live URL.

Run: `node_modules/.bin/vitest run server/meetings/meetings.test.ts`.
