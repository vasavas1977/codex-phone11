# Runbook: Phone11 profile/DND host admission and maintenance

> **22 September status:** The original controller sequence below is an admission
> requirement, not a commissioned runtime. The source proposal in
> `PROFILE-DND-AGGREGATE-MAINTENANCE-GUARD-20260922.md` uses explicit edge-first
> activation and separate SIP-first/edge-last release through existing temporary
> host access. It does not promise atomic cross-host restoration. The required
> Connect11 provider session/token reconnect fence does not exist yet; protected
> replacement phases must refuse `provider_fence_uncommissioned`. No baseline
> replacement is authorized by source tests or a zero-count snapshot alone.

**Owner:** Phone11 operations and telephony owner | **Frequency:** one controlled rollout
**Last updated:** 21 September 2026 | **Last run:** never

## Purpose and decision

This runbook defines the smallest host-specific maintenance boundary required
before the approved profile/DND rollout operator may replace `cp11-backend`.
It prepares evidence only. It does not authorize or record a production change.

The rollout remains **blocked**. The public HTTP side has an identifiable
control point at the separate `api.phone11.ai` edge host. The SIP side has no
reviewed initial-INVITE admission switch in the checked-in or recorded live
Kamailio contract. A snapshot showing zero calls cannot close the race in which
a new INVITE arrives before `cp11-backend` stops. The telephony owner must
choose and authorize one verifiable control that rejects only new initial
INVITEs while continuing established-dialog ACK, BYE, CANCEL and re-INVITE.
The control must cover PSTN and registered-extension calls. Carrier-only
maintenance is insufficient because it does not cover local-extension calls.

Do not replace that decision with a timestamp, operator lock, user notice,
security-group closure, broad firewall rule, Kamailio restart, or a claim that
`docker stop --time 20` is safe. Those choices either do not fence every source
or can interrupt existing dialogs. The profile rollout itself must leave the
approved Kamailio and FreeSWITCH bytes, wake URL and provider credentials
unchanged.

## Why the old baseline needs an external boundary

The API candidate source recorded on 20 September is
`50b6c3b62298b21baa778053d08ce1054422c608`. That commit demonstrates the old
lifecycle shape: SIGTERM calls `runtime.background.stop()` without awaiting it,
closes the HTTP server without awaiting admitted requests, and the ordinary
notification dispatcher stop handle does not wait for its active APNs attempt.
The release correction
`d05a32ab4e80db25d681a75a08d124e3819c295b` closes HTTP admission, drains
admitted handlers, then awaits worker stop handles under one bounded deadline.
That correction protects later restarts; it cannot change the already-running
old process before its first replacement.

The default runtime owns these services together:

| Owner | Admission or work surface | Required maintenance evidence |
| --- | --- | --- |
| Public API candidate on 3002 | `/api/trpc` profile, presence, chat, conference and meeting calls | Edge gate rejects new mutating traffic and tRPC batches before the VoIP host |
| Baseline on 3000 | `/api/chat/media/upload` | Edge gate rejects uploads while authenticated media reads may remain available |
| Kamailio and wake on 3000 | initial SIP INVITEs and `/api/phone11/wake/{offer,terminal}` | New initial INVITEs fenced; established dialogs and their wake cleanup remain routable |
| FreeSWITCH callbacks on 3000 | `/api/freeswitch/{directory,dialplan,event,cdr}` and `/api/freeswitch/cdr` | No active channel/conference and no SIP transaction before stop |
| Recording routes/workers | `/api/recordings`, capture reconciliation, analysis and retention | No recording/capture job in a live or leased state |
| Chat workers | notification dispatcher and media retention | No eligible queued alert, no new attempt during the stability window, and no active database transaction |
| Process services | ESL listener and WebSocket shutdown | Exact sole default worker identity; no duplicate default runtime |

The candidate is intentionally workerless. Keeping public reads on 3002 does
not make chat sends safe: a candidate chat mutation can enqueue work that the
old dispatcher immediately claims.

## Prerequisites

- [ ] Exact final 40-character release SHA and exact live baseline source SHA
      are recovered from independently verified image labels/build evidence.
      An absent or ambiguous baseline source identity blocks the rollout.
- [ ] The source inventory below is generated from a clean repository and
      independently reviewed. Its `host_admission_ready` value remains `false`
      by design; it is source evidence, not a host fence.
- [ ] The edge-host operator has root access to the exact active
      `api.phone11.ai` server block and can atomically install and restore
      pinned bytes, syntax-check, reload, and verify the serving generation.
- [ ] The telephony owner has selected and separately reviewed the initial
      INVITE control described above, including activation, observation and
      rollback commands. No such control is currently commissioned.
- [ ] A read-only database role can return aggregate counts only. It must not
      return message bodies, device tokens, recording paths, customer rows or
      credentials.
- [ ] The existing rollout manifest, frozen Compose inputs, immutable image,
      migration artifacts, rollback image and durable intent all pass the
      approved rollout operator's normal checks.
- [ ] A maintenance window is announced for temporary chat/profile/presence
      writes and new calls. Existing calls must end normally before activation.

## Prepare immutable source evidence

From the clean reviewed checkout, set both SHAs from approved evidence. Do not
infer the running baseline SHA from a branch name or mutable image tag.

```sh
umask 077
REPO="$PWD"
RELEASE_SHA="<FINAL_40_CHARACTER_RELEASE_SHA>"
BASELINE_SHA="<LIVE_40_CHARACTER_BASELINE_SOURCE_SHA>"
install -d -m 0700 /root/phone11-profile-dnd-admission
python3 scripts/phone11-profile-dnd-source-inventory.py \
  --repo "$REPO" \
  --release-sha "$RELEASE_SHA" \
  --baseline-sha "$BASELINE_SHA" \
  > /root/phone11-profile-dnd-admission/source-inventory.json
chmod 0600 /root/phone11-profile-dnd-admission/source-inventory.json
sha256sum /root/phone11-profile-dnd-admission/source-inventory.json
```

**Expected result:** one canonical JSON document naming the seven HTTP
admission roots, seven default services, per-file committed hashes, candidate
worker isolation and both lifecycle classifications. It always says
`"source_only":true,"host_admission_ready":false`.

**If it fails:** stop. A shortened SHA, unavailable commit, missing source file
or changed route/worker anchor is unresolved topology drift.

## Commissioning packet for the two admission controls

The packet is root-owned mode `0600` under
`/root/phone11-profile-dnd-admission`. It contains no secrets. Record only
absolute artifact paths and SHA-256 digests, exact host/instance identities,
the active and restore configuration digests, command binary digests, and
bounded aggregate results.

### Edge HTTP mutation gate

The gate runs on the separate public edge before traffic reaches the Phone11
host. It must cover both exact `/api/trpc` and prefix `/api/trpc/` for methods
that may carry mutations or batches, plus exact `/api/chat/media/upload`.
Because a tRPC batch can mix reads and writes, do not inspect request bodies at
Nginx and do not guess procedure names. Reject all tRPC POSTs during the brief
window. Existing authenticated GET reads may remain available only if the edge
configuration can prove method-specific handling without changing request
bodies, credentials or tenant headers.

The reviewed controller must atomically install pinned bytes, run `nginx -t`,
gracefully reload, and prove the new serving generation over fresh
`Connection: close` requests. Its restore command must atomically restore the
exact prior bytes and pass the same checks. Activation failure restores the
prior bytes before reporting failure. The VoIP-host Nginx file used by the
rollout operator is not this control and must remain byte-for-byte pinned.

### Initial SIP INVITE gate

The selected control must meet all of these tests before it can be named in a
production manifest:

1. A new PSTN initial INVITE is rejected with the reviewed temporary response.
2. A new registered-extension initial INVITE is rejected the same way.
3. REGISTER, OPTIONS and presence traffic retain their existing behavior.
4. ACK, BYE, CANCEL and in-dialog re-INVITE for an established test dialog
   continue through the existing route.
5. The current `http://127.0.0.1:3000/api/phone11/wake` occurrence count and
   bytes remain unchanged.
6. Activation and release are observable through a machine-readable control
   state, not inferred from call counts.
7. A timeout, ambiguous response or partial activation fails closed and runs
   the separately reviewed restore path.

This task does not provide those bytes or commands because no existing control
was found and changing SIP configuration is outside the approved rollout.
The exact remaining owner decision is: **authorize a separately reviewed
Kamailio initial-INVITE maintenance switch, or provide an already deployed
all-source equivalent with its host access path and immutable evidence.**

## Guard-controller sequence

The host-specific `guard.program` is commissioned only after both controls
exist. Its phase behavior is exact:

1. On `--phase prepare`, perform read-only discovery. Report the fence inactive
   and never change either host. This lets the rollout operator complete normal
   protected direct/public probes.
2. On `--phase replace-baseline-before`, acquire the controller's exclusive
   operation identity, activate the edge gate, then activate the SIP gate.
   Persist and fsync a root-only activation record bound to both before/after
   configuration hashes, controller hashes, host identities, operation ID and
   expiry. If either activation is incomplete, restore both and fail.
3. With both gates active, wait for existing work to drain. Require zero
   FreeSWITCH channels and conferences, zero Kamailio dialogs, zero active SIP
   transactions, zero RTP relay calls, zero pending/ready wake calls, zero live
   meeting/provider sessions, zero pending conference operations, zero
   recording `pending`/`recording` states, zero recording `processing` leases,
   zero purge leases, and zero pending capture uploads.
4. Require zero currently eligible notification rows, then observe a stability
   interval of at least 15 seconds. During it there must be no new `attempted`
   notification and no non-idle application database transaction. This bounds
   the old dispatcher's five-second tick and five-second APNs budget without
   claiming that an instantaneous count proves quiescence.
5. Sample every source again. Only then emit the existing bounded
   `phone11-profile-dnd-guard/v1` aggregate with the active fence identity and
   evidence digest. Never output IDs, bodies, tokens, paths or credentials.
6. On every stopped/restart phase, prove the same operation ID, evidence digest,
   serving gate generations and future expiry before returning zero counts.
7. Keep both gates active until the new baseline is healthy, the rollout
   operator has checked wake and notification readiness, and the operator has
   recorded its baseline replacement receipt.
8. Release the SIP gate first, verify normal call admission, then release the
   edge gate and verify the exact prior edge bytes. Archive the activation and
   release records; never edit or reuse them.

No readiness statement is valid until the commissioned helper passes an
independent failure-injection review: edge activation failure, SIP activation
failure, active call appearing during drain, new chat attempt during the
stability interval, controller expiry, host identity drift, ambiguous probe,
partial restore and helper crash after either activation.

## Rollout and rollback

After commissioning, run the existing operator exactly as documented in
`PROFILE-DND-ROLLOUT-OPERATOR-20260920.md`. The controller activates only when
that operator reaches `replace-baseline-before`; a standalone `--prepare`
remains read-only.

If baseline start fails before DND exposure, keep both gates active while the
operator restores the exact old image. If DND has been exposed, use only
`--rollback-baseline-disabled`; the old dispatcher must start with ordinary
chat notifications disabled. A failed or absent replacement is recovered from
the durable pre-mutation intent. The additive schema and pending outbox/profile
rows remain.

If either admission control loses authority during stop, restart or rollback,
do not release the other control and do not improvise a container identity.
Use the pinned durable intent and emergency rollback path. Escalate to the
Phone11 telephony owner and backend operator with aggregate stage/error names
only.

## Verification and current exit state

- [ ] Source inventory SHA recorded and independently reviewed.
- [ ] Edge controller installed, immutable, failure-tested and reversible.
- [ ] Initial-INVITE controller selected, installed, immutable,
      failure-tested and reversible.
- [ ] Root-only aggregate helper proves both live controls and every drain
      source without revealing customer or secret data.
- [ ] Operator dry run passes against freshly pinned release/runtime artifacts.
- [ ] Maintenance window and rollback owner named.

As of this document, only the first item can be prepared offline. The missing
SIP control and its owner-authorized host access remain the exact blocker. No
rollout, migration, image build, provider change or production command was run.
