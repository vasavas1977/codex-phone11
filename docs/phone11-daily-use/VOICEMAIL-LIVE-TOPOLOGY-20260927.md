# Voicemail runtime topology — 2026-09-27

Workspace status is live on the 3012 API. Voicemail storage/deposit and DND are
not live. These are read-only observations, not call acceptance.

## Actual endpoints

- Live tRPC: `cp11-api-candidate-status`, loopback 3012, API-only role.
- Existing callback/worker backend: `cp11-backend`, port 3000.
- FreeSWITCH directory: host systemd `phone11ai-backend.service`, port 3001,
  working directory `/opt/phone11ai/cloudphone11`. Its database authentication
  fails; lookups for 3001 and 1020 returned XML without a user.
- Maintained 3012 directory also returned empty XML, for a different reason:
  its query referenced absent `extensions.call_forwarding_enabled`. The
  maintained-schema projection and XML escaping are fixed in candidate source.
- FreeSWITCH XML curl binds directory only. Dialplan is static. Its current
  legacy directory URL carries query authentication; the maintained endpoint
  rejects query secrets and requires a header or scoped Basic authentication.
  A future binding change must pair the reviewed configuration with a verified
  endpoint. Do not print or copy the existing query credential into evidence.

## No-answer routing gap

The live Kamailio configuration differs from the checked-in base. Four-digit
internal calls use the local registration or Flexisip/wake paths. Their attached
failure handlers clean up media but do not invoke voicemail. The separate old
`INVITE_FAILURE` voicemail handler is not attached to these transactions.
Carrier calls to 020303001 have a separate recording-anchor/inbound-pilot path.
The active static FreeSWITCH fallback covers 1000–1019, excluding both pilot
extensions 3001 and 1020. No active XML invokes the Phone11 deposit Lua hook.

Therefore enabling a mailbox or deploying the producer alone cannot establish
voicemail delivery. A reviewed, tenant-authorized and cancellation-aware deposit
ingress is still required. Preserve answered-call media, wake, carrier recording,
and existing SIP behavior. Never enable the entire XML curl dialplan as a shortcut.

## Staging boundary

The next candidate is loopback-only 3013, API-only, voicemail hook false. Staging
must not change Nginx, FreeSWITCH, Kamailio, database schema, mailbox flags, or
worker ownership. Verify directory responses and authentication denials using
redacted summaries, never returned credential XML. Duplicate active SIP identities
must fail closed rather than selecting a tenant by database row order.

## Remaining acceptance

1. Independently review and stage the corrected private API candidate.
2. Validate directory identities and auth denials against the maintained database.
3. Implement/review the actual no-answer route and isolated call-level cases.
4. Rehearse storage migration and relay/producer recovery using fresh evidence.
5. Apply the reviewed coupled release and run real handset deposits, playback,
   cancellation, answered-call and cross-tenant denial checks.

DND has a separate worker-maintenance dependency. The old aggregate guard's
`provider_fence_uncommissioned` refusal must not be bypassed. Connect11's source
assessment that established external video media is independent of port 3000 is
not runtime proof of safe worker shutdown or fresh admission during a handoff.
