# No-answer voicemail ingress: source and live-route plan

This is a plan, not a routing candidate or activation record. No call route, host,
FreeSWITCH binding, mailbox flag, or deployment was changed. The 27 September
read-only live trace observed Kamailio config SHA-256
`700f468517d2644f5f853509263ea365fbf4506b9776fa5646ef1b3a42fa90ac`
and FreeSWITCH `default.xml` SHA-256
`c2971bb38fbc0a53848820bf7b42d16c20a9bd14b1067a192f6ea09953b9045e`.
Recheck both before preparing a private candidate.

## Why the present hook does not run

- Registered 4-digit local calls go from Kamailio `lookup(location)` directly to
  Siprix over its native/SRTP path. `LOCAL_EXTENSION_FAILURE` only cleans up
  RTPengine. The enabled 3001↔1020 wake path uses
  `PHONE11_WAKE_FAILURE`, which cleans media and reports a terminal wake state;
  it does not create a voicemail branch. A failed unregistered lookup goes to
  Flexisip `RELAY`, with no voicemail failure handler.
- The old `INVITE_FAILURE` rewrite to `*97...` is not attached to those local
  transactions. Its target is not a tenant-authorized mailbox instruction.
  Attaching it broadly could act on one failed fork while another answers or
  after CANCEL.
- The loaded FreeSWITCH static `Local_Extension` fallback covers only
  1000–1019. The reviewed `voicemailDialplanActions` in
  `server/pbx/voicemail-dialplan.ts` requires a call to reach the dynamic XML
  dialplan; it cannot affect the direct Kamailio paths. The live XML-curl
  dialplan binding is disabled. Do not enable it merely to reach this hook.
- The loaded Kamailio config unconditionally calls
  `PHONE11_RECORDING_ANCHOR` before the carrier DID pilot check. Its exact
  carrier-source/DID gate sends matching calls to FS; no real matching call
  trace was observed in this audit. Confirm the effective A-leg/B-leg path
  with one supervised call before changing its continuation. The checked-in recording
  anchor context has `hangup_after_bridge=true` and `continue_on_fail=false`,
  so it cannot presently continue into voicemail after a failed bridge.

## Smallest safe boundary

Use one dedicated, private FreeSWITCH voicemail ingress, separate from the
general XML dialplan and from the existing recording upload API. Kamailio
should select it only after **all** eligible handset/Flexisip branches have
ended in genuine no-answer or timeout, while the original caller transaction
is still alive. The initial pilot excludes 486 Busy and all other failures.
The wake and recording-anchor failure handlers retain their media/terminal
cleanup; an exact new handler may run only after that cleanup and only for
the guarded pilot route. Never use caller-supplied `From`, `P-Asserted-Identity`,
query fields, SIP headers, extension number alone, or a returned FS marker as
mailbox authority.

1. At the existing source/auth gate, preserve an immutable route identity on
   the dialog/transaction: original Call-ID and From tag, route class, exact
   canonical destination, and authenticated `$au/$ar` for registered local
   callers. The 3001↔1020 wake target comes from its already validated dialog
   target. For an unregistered destination that later goes to Flexisip, retain
   the authenticated caller identity **before** relay. For the carrier DID,
   retain its verified source and exact DID mapping; if the caller A leg is at
   FS, keep that leg and apply the same authority check before any deposit.
2. A new server-only `POST /api/phone11/voicemail/fallback` (illustrative path)
   must authenticate the calling proxy with a dedicated integration credential.
   In one bounded transaction it resolves exactly one active `sip_accounts`
   caller in its realm and tenant, or exactly one approved source-gated DID
   mapping for a carrier leg. It resolves the target extension in that **same
   tenant**, current active owner/assignment, enabled voicemail, and current
   owner epoch. Ambiguous or missing identity, source, tenant, or mailbox fails
   closed. Return a bounded route decision with an opaque short-lived one-use
   reference bound to the exact target and owner epoch. Do not return a
   caller-constructed Lua argument or authorize from `tenant_id` supplied by
   Kamailio alone.
3. Let Kamailio TM retain the authoritative original SIP transaction, including
   all branch outcomes, CANCEL, and lifetime. The existing wake path already
   uses `http_async_client` to suspend/resume a transaction and checks
   `t_is_canceled()` and `t_is_expired()` before relay. In a disposable
   Kamailio 5.8 fixture, prove the same behavior **inside the final failure
   route**: after all branches have failed, suspend for bounded authorization,
   then recheck cancellation, expiry, final response class and a transaction
   marker before adding exactly one FS branch. A late callback must exit,
   never originate a fresh INVITE. Do not create a parallel database SIP-state
   ledger unless the fixture demonstrates a specific duplicate/late-response
   race that TM cannot close. Keep the existing
   `voicemail_deposit_admissions` owner-epoch check as the later media gate;
   its current endpoint does not by itself authorize fallback routing.
4. Send the selected original caller leg to an allowlisted private FS SIP
   socket/context with a fixed route marker and the opaque reference. FS must
   accept only the exact Kamailio source socket. A new static, dedicated
   context/Lua entry redeems the reference over an authenticated backend
   channel, validates the current owner epoch and `session:ready()`, then
   invokes the commissioned producer/admission and `mod_voicemail` using only
   backend-returned canonical tenant/extension/account/domain. The existing
   reviewed Lua hook assumes a failed FS bridge and checks
   `bridge_hangup_cause`; do not call it on a fresh FS leg by fabricating that
   variable. Refactor a shared producer/deposit routine or add a separately
   reviewed ingress adapter. FS must not answer/record if redemption fails.
5. Preserve media direction explicitly. Local Siprix SDES-SRTP and a private
   plain-RTP FS ingress need a reviewed RTPengine conversion; the existing
   local phone-to-phone offer is not such a conversion. A carrier plain-RTP
   leg already anchored at FS should continue on that A leg after a guarded
   failed B leg, rather than loop into a second FS ingress. Final-branch
   cleanup must not delete media for another still-live fork. No 486, 3xx,
   5xx/6xx, explicit rejection, caller CANCEL, answered call, or admission/API
   failure may produce a voicemail recording in the initial pilot.

The fallback request/response timing must fit the live SIP transaction budget.
The maintained wake candidate's `http_async_query` already suspends a live TM
transaction. Reuse that pattern only after the failure-route fixture proves it
preserves the original transaction and its cancellation/expiry guards there.
Kamailio's [HTTP async client](https://www.kamailio.org/docs/modules/devel/modules/http_async_client)
documents transaction suspension and callbacks from any route; its
[TM documentation](https://www.kamailio.org/docs/modules/5.8.x/modules/tm.html)
defines `t_is_canceled()` and `t_is_expired()`. These docs do not substitute
for a running 5.8 fixture with forked calls and late callbacks.

## Proposed source ownership and checks

| Work | Exact files to create or change | Required proof |
| --- | --- | --- |
| Authority and one-use reference | New `server/pbx/voicemail-fallback-authority.ts` and `server/pbx/voicemail-fallback-routes.ts`; mount narrowly in `server/_core/index.ts`. Add a small migration only if one-use redemption cannot use an existing durable authority pattern. | Disposable PostgreSQL role/tenant/owner-epoch, duplicate authorization and reference redemption tests; TM owns CANCEL/answer state. |
| Proxy branch candidate | New `infra/configs/kamailio/phone11-voicemail-fallback-candidate/routes.inc`; then a separately reviewed private diff against the exact live Kamailio config | Kamailio 5.8.4 parser in gate-off/on modes; isolated forked 486→200, all-branch timeout, matched CANCEL, Flexisip failure, wake failure, late HTTP and media cleanup fixtures; no extra DB SIP ledger unless a fixture proves TM insufficient. |
| FS dedicated ingress | New `infra/configs/freeswitch/phone11-voicemail-fallback-candidate/` context/entry and Lua adapter; narrowly refactor `infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua` only if sharing its producer lifecycle | Source-IP and reference refusal, no answer before redemption, exact canonical mailbox, answered bypass, caller abandon, >3-second message and no duplicate WAV in a clone |
| Existing guards | Preserve `server/pbx/recording-storage.ts`, `server/pbx/voicemail-storage-migration.sql`, the current `server/pbx/voicemail-dialplan.ts` gate, and the guarded 3001/1020 wake patch unless an exact interface change is justified | Existing voicemail PostgreSQL/producer/relay, wake/fork, calling and recording-anchor tests remain green |

Before any host change, run `pnpm check`, `pnpm build:backend`, focused
voicemail and wake tests, isolated PostgreSQL authority/owner-epoch tests,
the Kamailio parser and SIP fork fixtures, and the FreeSWITCH callback clone.
The current commissioning checks in `VOICEMAIL-COMMISSIONING-20260926.md`
remain required; they prove storage/producer behavior but not ingress routing.

## Supervised call acceptance and rollback

Use only the approved 3001 and 1020 pilot pair and one explicitly enabled
mailbox. An earlier 27 September read-only snapshot had voicemail disabled
for both; their current flags and owner epochs require fresh action-time
readback. Record source/config/image hashes, route class, anonymized original
Call-ID, route-reference/admission/message IDs and timestamps. Test, in order:
answered local 3001→1020 and reverse; both phones active with no answer;
recipient offline through Flexisip; recipient locked through wake; caller
CANCEL before timeout, during authorization, before FS answer and during
recording; forked 486 then 200; 486-only remains ordinary Busy; carrier DID while the
target is answered and unanswered; duplicate retransmission; API/FS/relay
unavailable; owner reassignment or voicemail disable during setup. For each
no-answer deposit, verify one private WAV, one inbox row and playback by only
the current owner, with actual two-way caller/FS audio where applicable.
Verify no deposit on every answered/cancelled/denied path, and preserve the
existing SIP wake, carrier recording and background call behavior.

Activation must be one mailbox and one route class at a time, after the
separate source, migration, FS, proxy and handset gates pass. Roll back the
private Kamailio route define/context first and verify ordinary SIP handling;
restore the pinned FS context, leave the existing
`PHONE11_VOICEMAIL_HOOK_READY=false` if the producer has not passed its own
gates, then disable that pilot mailbox if needed. Drain in-flight calls and
retain private WAVs, admissions, any one-use references and outbox for reconciliation. Do
not remove schema or delete queued media as an API rollback step.

The lead has selected an initial no-answer/timeout-only pilot and carrier
continuation on the existing FS A leg. Remaining technical proof gates are
the exact FS B-leg failure continuation, Kamailio failure-route TM/HTTP
suspension and local SRTP-to-RTP conversion. Keep 486 Busy ineligible.
